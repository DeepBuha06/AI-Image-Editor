import { NextResponse } from "next/server";
import { uploadImage, submitWorkflow, waitForResult, getResultImage } from "../../../lib/comfyui.js";

export async function POST(req) {
    try {
        const { image, sketch, sketchPrompt } = await req.json();

        if (!image || !sketch || !sketchPrompt) {
            return NextResponse.json({ error: "Missing image, sketch, or sketchPrompt" }, { status: 400 });
        }

        const uploadedImage = await uploadImage(image, "input");
        const uploadedSketch = await uploadImage(sketch, "sketch");

        const enhancedPositive = `${sketchPrompt}, highly detailed, photorealistic, seamlessly integrated into scene, consistent lighting and perspective`;
        const enhancedNegative = "sketch lines, drawing artifacts, rough edges, unrealistic";

        const prompt = {
            "1": {
                "class_type": "LoadImage",
                "inputs": { "image": uploadedImage }
            },
            "2": {
                "class_type": "ImageScale",
                "inputs": {
                    "upscale_method": "nearest-exact",
                    "width": 1024,
                    "height": 1024,
                    "crop": "disabled",
                    "image": ["1", 0]
                }
            },
            "3": {
                "class_type": "LoadImage",
                "inputs": { "image": uploadedSketch }
            },
            "4": {
                "class_type": "ImageScale",
                "inputs": {
                    "upscale_method": "nearest-exact",
                    "width": 1024,
                    "height": 1024,
                    "crop": "disabled",
                    "image": ["3", 0]
                }
            },
            "5": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": { "ckpt_name": "sd_xl_base_1.0.safetensors" }
            },
            "6": {
                "class_type": "CLIPTextEncode",
                "inputs": { "text": enhancedPositive, "clip": ["5", 1] }
            },
            "7": {
                "class_type": "CLIPTextEncode",
                "inputs": { "text": enhancedNegative, "clip": ["5", 1] }
            },
            "8": {
                "class_type": "ControlNetLoader",
                "inputs": { "control_net_name": "controlnet_scribble_sdxl.safetensors" }
            },
            "9": {
                "class_type": "ControlNetApply",
                "inputs": {
                    "strength": 0.8,
                    "conditioning": ["6", 0],
                    "control_net": ["8", 0],
                    "image": ["4", 0]
                }
            },
            "10": {
                "class_type": "VAEEncode",
                "inputs": { "pixels": ["2", 0], "vae": ["5", 2] }
            },
            "11": {
                "class_type": "ImageToMask",
                "inputs": { "channel": "red", "image": ["4", 0] }
            },
            "12": {
                "class_type": "SetLatentNoiseMask",
                "inputs": {
                    "samples": ["10", 0],
                    "mask": ["11", 0]
                }
            },
            "13": {
                "class_type": "KSampler",
                "inputs": {
                    "seed": Math.floor(Math.random() * 10000000),
                    "steps": 40,
                    "cfg": 7.5,
                    "sampler_name": "dpmpp_2m",
                    "scheduler": "karras",
                    "denoise": 0.9,
                    "model": ["5", 0],
                    "positive": ["9", 0], // The applied controlnet conditioning
                    "negative": ["7", 0],
                    "latent_image": ["12", 0]
                }
            },
            "14": {
                "class_type": "VAEDecode",
                "inputs": { "samples": ["13", 0], "vae": ["5", 2] }
            },
            "15": {
                "class_type": "SaveImage",
                "inputs": {
                    "filename_prefix": "pixxel_sketch",
                    "images": ["14", 0]
                }
            }
        };

        const promptId = await submitWorkflow(prompt);
        const resultFilename = await waitForResult(promptId);
        const finalImageBase64 = await getResultImage(resultFilename);

        return NextResponse.json({ success: true, result: finalImageBase64 });

    } catch (err) {
        console.error("Sketch API Error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
