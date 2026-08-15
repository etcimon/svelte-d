module comfyapi;

import vibe.d;
import std.uuid;
import std.file;
import std.datetime;
import std.conv;

class ComfyUIService {
    string serverAddress;
    string workflowPath;

    this(string serverAddress = "127.0.0.1:8188", string workflowPath = "workflow_api.json") {
        this.serverAddress = serverAddress;
        this.workflowPath = workflowPath;
    }

    Json loadWorkflow(string workflowPath) {
        auto content = readText(workflowPath);
        return parseJson(content);
    }

    Json queuePrompt(Json prompt, string clientId) {
        auto data = Json([
            "prompt": prompt,
            "client_id": clientId
        ]);
        auto response = HTTPClient().post("http://" ~ serverAddress ~ "/prompt", data.toString(), ["Content-Type": "application/json"]);
        return parseJson(response.bodyReader.readAllUTF8());
    }

    Json updateWorkflow(Json prompt, string inputPath) {
        auto idToClassType = prompt.object.byKeyValue.map!(kv => kv.key).assocArray;
        auto imageLoader = idToClassType.byKeyValue.filter!(kv => kv.value == "LoadImage").front.key;
        auto filename = inputPath.baseName;
        prompt[imageLoader]["inputs"]["image"] = filename;
        return prompt;
    }

    void trackProgress(WebSocket ws, string promptId) {
        while (true) {
            try {
                auto wsMsg = ws.receiveText();
                auto message = parseJson(wsMsg);
                auto messageType = message["type"].str;

                if (messageType == "progress") {
                    auto data = message["data"];
                    logInfo("Progress: %s/%s".format(data["value"].to!string, data["max"].to!string));
                } else if (messageType == "executing") {
                    logInfo("Executing node: %s".format(message["data"]["node"].str));
                } else if (messageType == "execution_cached") {
                    logInfo("Cached execution: %s".format(message["data"].toString()));
                }

                if (messageType == "executed" && message["data"]["prompt_id"].str == promptId) {
                    logInfo("Generation completed");
                    return;
                }
            } catch (Exception e) {
                logError("Error processing message: %s".format(e.msg));
                return;
            }
        }
    }

    Json getHistory(string promptId) {
        Json res_body;

        auto response = requestHTTP("http://" ~ serverAddress ~ "/history/" ~ promptId, (scope req) {
            req.method = HTTPMethod.GET;
        }, (scope res) {
            res_body = response.readJson();
        });
        return res_body;
    }

    void uploadImage(string inputPath, string filename, string folderType = "input", string imageType = "image", bool overwrite = false) {
        
        requestHTTP("http://" ~ serverAddress ~ "/upload/" ~ imageType, (scope req) {
            req.method = HTTPMethod.POST;
            req.headers["Content-Type"] = "multipart/form-data";
            auto multiPart = new CustomMultiPart(req.headers, "type", folderType)
                .addSibling(new CustomMultiPart(req.headers, "overwrite", overwrite.to!string))
                .addSibling(new FileMultiPart(req.headers, "image", inputPath));
            req.writeBody(multiPart);
        }, (scope res) {
            logInfo("Image uploaded: %s".format(res.statusCode));
        });
    }

    Json generate(Json generationParameters) {
        auto clientId = UUID().toString();
        auto history = Json();
        connectWebSocket(URL.parse("ws://" ~ serverAddress ~ "/ws?clientId=" ~ clientId), (scope ws) {
     
            auto workflow = loadWorkflow(workflowPath);
            workflow = updateWorkflow(workflow, generationParameters["input_path"].get!string);

            uploadImage(generationParameters["input_path"].get!string, "sung-choi-cockpit-sungchoi-1600px.jpg");

            auto promptResponse = queuePrompt(workflow, UUID().toString());
            auto promptId = promptResponse["prompt_id"].get!string;

            trackProgress(ws, promptId);

            history = getHistory(promptId);
        });
   
        return history;
    }
}

void backgroundTask() {
    auto service = new ComfyUIService();
    auto generationParameters = Json.emptyObject();
    generationParameters["input_path"] = "../uploads/sung-choi-cockpit-sungchoi-1600px.jpg";

    auto history = service.generate(generationParameters);
    logInfo("Generation history: %s".format(history.toString()));
}


    

/*
import uuid
import websocket
import json
import random
import asyncio
import requests
import asyncio
import uvicorn
from datetime import datetime
from fastapi import FastAPI
import os

app = FastAPI()
generation_parameters = {
    "input_path": "../uploads/sung-choi-cockpit-sungchoi-1600px.jpg",
}

class ComfyUIService():
    def __init__(self, server_address='127.0.0.1:8188', workflow_path='workflow_api.json'):
        self.server_address = server_address
        self.workflow_path = workflow_path
       
    async def establish_connection(self):
        client_id = str(uuid.uuid4())
        ws = websocket.WebSocket()
        ws.connect(f"ws://{self.server_address}/ws?clientId={client_id}")
        return ws, self.server_address, client_id
    
    def load_workflow(self, workflow_path):
        with open(workflow_path, 'r') as file:
            return json.load(file)
        
    async def queue_prompt(self, prompt, client_id, server_address):
        """Queue a workflow for execution. The prompt here is the full workflow_api.json file"""
        data = {"prompt": prompt, "client_id": client_id}
        headers = {'Content-Type': 'application/json'}
        response = requests.post(f"http://{server_address}/prompt", json=data, headers=headers)
        return response.json()
        
    def update_workflow(self, prompt, input_path):
        id_to_class_type = {id: details['class_type'] for id, details in prompt.items()}
        """Update the path to the input image"""
        image_loader = [key for key, value in id_to_class_type.items() if value == 'LoadImage'][0]
        filename = input_path.split('/')[-1]
        prompt.get(image_loader)['inputs']['image'] = filename

        return prompt
    
    def track_progress(self, ws, prompt_id):
        """Track the progress of image generation"""
        while True:
            try:
                message = json.loads(ws.recv())
                print(message['type'])
                if message['type'] == 'progress':
                    '''If the workflow is running print k-sampler current step over total steps'''
                    print(f"Progress: {message['data']['value']}/{message['data']['max']}")
                
                elif message['type'] == 'executing':
                    '''Print the node that is currently being executed'''
                    print(f"Executing node: {message['data']['node']}")
                
                elif message['type'] == 'execution_cached':
                    '''Print list of nodes that are cached'''
                    print(f"Cached execution: {message['data']}")
                
                '''Check for completion'''
                if (message['type'] == 'executed' and 
                    'prompt_id' in message['data'] and 
                    message['data']['prompt_id'] == prompt_id):
                    print("Generation completed")
                    return True
                
            except Exception as e:
                print(f"Error processing message: {e}")
                return False
    
    async def get_history(self, prompt_id, server_address):
        """Fetch the output data for a completed workflow, returns a JSON with generation parameters and results filenames and directories"""
        response = requests.get(f"http://{server_address}/history/{prompt_id}")
        return response.json()

    async def download_file(self, filename, subfolder, folder_type, server_address):
        """Fetch results. Note that "save image" nodes will save image in the ouptut folder and "preview image" nodes will save image in the temp folder"""
        params = {"filename": filename, "subfolder": subfolder, "type": folder_type}
        response = requests.get(f"http://{server_address}/view", params=params)
        return response.content

    def upload_image(self, input_path, filename, server_address, folder_type="input", image_type="image", overwrite=False):
        """Upload an image or a mask to the ComfyUI server. input_path is the path to the image/mask to upload and image_type is either image or mask"""
        
        with open(input_path, 'rb') as file:
            files = {
                'image': (filename, file, 'image/png')
            }
            data = {
                'type': folder_type,
                'overwrite': str(overwrite).lower()
            }
            url = f"http://{server_address}/upload/{image_type}"
            response = requests.post(url, files=files, data=data)
            return response.content
       
    async def generate(self, generation_parameters):
        ws, _, client_id = await self.establish_connection()
       
        try:
            """Update the workflow with the generation parameters"""
            workflow = self.load_workflow('workflow_api.json')
            workflow = self.update_workflow(workflow, 
                                            input_path=generation_parameters['input_path'],
                                            )
            
            """Upload the input image to the server"""
            self.upload_image(input_path=generation_parameters['input_path'], filename='sung-choi-cockpit-sungchoi-1600px.jpg', server_address=self.server_address)
            
            """Send the workflow to the server"""
            prompt_id = await self.queue_prompt(workflow, client_id, self.server_address)
            prompt_id = prompt_id['prompt_id']

            """Track the progress"""
            completed = self.track_progress(ws, prompt_id)
            if not completed:
                print("Generation failed or interrupted")
                return None

            """Fetch the output data"""    
            history = await self.get_history(prompt_id, self.server_address)
            outputs = history[prompt_id]['outputs']
            print(outputs)

            '''Get output images'''
            for node_id in outputs:
                node_output = outputs[node_id]
                videos_output = []
                if 'gifs' in node_output:
                    for video in node_output['gifs']:
                        video_data = await self.download_file(video['filename'], video['subfolder'], video['type'], self.server_address)
                        videos_output.append(video_data)
            return videos_output
           
        finally:
            ws.close()
            
async def background_task():
    service = ComfyUIService()
    video_output = await service.generate(generation_parameters)
    with open('output.mp4', 'wb') as file:
        file.write(video_output[0])
    d = datetime.now()
    return d.ctime()

@app.on_event("startup")
async def startup_event():
     # Runs in the background without blocking FastAPI
     print("Startup event")

@app.get("/")
async def read_root():
    print(os.getcwd())
    filename = await asyncio.create_task(background_task()) 
    return {"message": f"Video file generated {filename}"}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
*/