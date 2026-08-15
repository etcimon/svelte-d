import json
import os
import re
import subprocess
import struct

def run_wasm_objdump(wasm_file, objdump_file):
    """
    Run wasm-objdump on the given wasm file and save the output.
    """
    try:
        subprocess.run([
            "wasm-objdump", "-d", "--debug", wasm_file
        ], stdout=open(objdump_file, 'w', encoding='utf-8'), stderr=subprocess.DEVNULL, check=True)
    except subprocess.CalledProcessError:import json
import os
import re
import subprocess
import struct

def run_wasm_objdump(wasm_file, objdump_file):
    """
    Run wasm-objdump on the given wasm file and save the output.
    """
    try:
        subprocess.run([
            "wasm-objdump", "-d", "--debug", wasm_file
        ], stdout=open(objdump_file, 'w', encoding='utf-8'), stderr=subprocess.DEVNULL, check=True)
    except subprocess.CalledProcessError:
        pass


def get_dub_source_directories():
    """
    Use dub to get the list of source directories for the project's dependencies.
    """
    try:
        result = subprocess.run(
            ["dub", "describe", "--data=import-files"],
            capture_output=True,
            text=True,
            check=True
        )
        files = re.findall(r'"([^"]+)"', result.stdout)
        source_dirs = list(set(os.path.dirname(file) for file in files))
        return source_dirs
    except subprocess.CalledProcessError:
        return []


def parse_wasm_objdump(objdump_file):
    """
    Parse the wasm-objdump output to extract function names and assign them to source files.
    Updated to handle lines like:
    00fea4 func[82] <function_name>:
    """   
    function_pattern = re.compile(r'^\s*[0-9a-f]+\s+func\[\d+\]\s+<([^>]+)>:')
    file_pattern = re.compile(r';; file: (.+)')

    mappings = []
    current_file = None

    with open(objdump_file, 'r', encoding='utf-8') as file:
        for line in file:
            file_match = file_pattern.search(line)
            if file_match:
                current_file = file_match.group(1)
            func_match = function_pattern.search(line)
            if func_match and current_file:
                current_function = func_match.group(1)
                mappings.append((current_file, current_function, 0))  # Line 0 placeholder
    return mappings


def add_custom_section(wasm_file, section_name, section_data):
    """
    Properly add a custom section to the .wasm file following WebAssembly's binary format.
    """
    try:
        with open(wasm_file, 'rb') as f:
            wasm_content = f.read()

        name_bytes = section_name.encode('utf-8')
        data_bytes = section_data.encode('utf-8')

        # Encode section name length and payload length using LEB128
        name_length_encoded = encode_unsigned_leb128(len(name_bytes))
        payload = name_length_encoded + name_bytes + data_bytes
        payload_length_encoded = encode_unsigned_leb128(len(payload))

        # Section ID 0 (custom section) + length + payload
        section = struct.pack('<B', 0) + payload_length_encoded + payload

        # Insert custom section after the 8-byte header (magic + version)
        wasm_with_section = wasm_content[:8] + section + wasm_content[8:]

        with open(wasm_file, 'wb') as f:
            f.write(wasm_with_section)

        print(f"✅ Custom section '{section_name}' added to {wasm_file}.")

    except Exception as e:
        print(f"❌ Failed to add custom section: {e}")


def encode_unsigned_leb128(value):
    """
    Encode an integer to unsigned LEB128 format.
    """
    result = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value != 0:
            byte |= 0x80
        result.append(byte)
        if value == 0:
            break
    return bytes(result)


def generate_wasm_map(wasm_file, directory, objdump_file, output_file='output.wasm.map'):
    """
    Generate a .wasm.map file from the wasm-objdump output and source directories.
    Each function is mapped to line 0 of its corresponding file.
    The sources are listed relative to the .wasm file location.
    """
    mappings = parse_wasm_objdump(objdump_file)
    source_dirs = [directory] + get_dub_source_directories()
    wasm_dir = os.path.dirname(os.path.abspath(wasm_file))

    # Build sources list and mapping relationships
    sources = []
    source_index = {}
    for src_dir in source_dirs:
        if os.path.exists(src_dir):
            for root, _, files in os.walk(src_dir):
                for file in files:
                    if file.endswith('.d'):
                        abs_path = os.path.join(root, file)
                        relative_path = os.path.relpath(abs_path, wasm_dir)
                        if relative_path not in source_index:
                            source_index[relative_path] = len(sources)
                            sources.append(relative_path)

    # Generate mappings field using VLQ (A == 0 offset here)
    mapping_str = ""
    for file_path, func_name, _ in mappings:
        file_idx = source_index.get(file_path, 0)
        mapping_str += f"AAAA;"  # Maps every function to line 0 (AAAA = 0 offsets)
    mapping_str = mapping_str.rstrip(";")

    wasm_map = {
        "version": 3,
        "file": os.path.basename(wasm_file),
        "sources": sources,
        "names": [func for _, func, _ in mappings],
        "mappings": mapping_str
    }

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(wasm_map, f, separators=(',', ':'))

    # Add the custom section with source map reference
    add_custom_section(wasm_file, "sourceMappingURL", os.path.basename(output_file))


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Generate .wasm.map from wasm-objdump output and add custom section.")
    parser.add_argument("--dir", required=True, help="Directory containing D source files.")
    parser.add_argument("--wasm", default="public/slideshow3dai.wasm", help="Path to the .wasm file.")
    parser.add_argument("--output", default="output.wasm.map", help="Output .wasm.map file.")

    args = parser.parse_args()
    objdump_file = "temp_objdump.txt"

    run_wasm_objdump(args.wasm, objdump_file)
    generate_wasm_map(args.wasm, args.dir, objdump_file, args.output)

    if os.path.exists(objdump_file):
        os.remove(objdump_file)


if __name__ == "__main__":
    main()