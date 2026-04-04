import { NextResponse } from "next/server";
import { uploadImage, submitWorkflow, waitForResult, getResultImage } from "../../../lib/comfyui.js";

export async function POST(req) {
    try {
        const { image, mask, addPrompt, placementHint } = await req.json();

        if (!image || !addPrompt) {
            return NextResponse.json({ error: "Missing image or addPrompt" }, { status: 400 });
        }

        const uploadedImage = await uploadImage(image, "input");

        // Construct the advanced prompt
        const enhancedPositive = `${addPrompt}, ${placementHint ? placementHint + ", " : ""}photorealistic, consistent lighting, natural scene integration, 8k, sharp focus`;
        const enhancedNegative = "floating, disconnected, unrealistic scale, bad anatomy, deformed, artifacts, watermark";

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
                "class_type": "CheckpointLoaderSimple",
                "inputs": { "ckpt_name": "sd_xl_base_1.0.safetensors" }
            },
            "4": {
                "class_type": "CLIPTextEncode",
                "inputs": { "text": enhancedPositive, "clip": ["3", 1] }
            },
            "5": {
                "class_type": "CLIPTextEncode",
                "inputs": { "text": enhancedNegative, "clip": ["3", 1] }
            },
            "6": {
                "class_type": "VAEEncode",
                "inputs": { "pixels": ["2", 0], "vae": ["3", 2] }
            }
        };

        let maskSourceNode = null;
        let maskIndex = 0;

        if (mask) {
            const uploadedMask = await uploadImage(mask, "mask");
            prompt["7"] = {
                "class_type": "LoadImage",
                "inputs": { "image": uploadedMask }
            };
            prompt["8"] = {
                "class_type": "ImageScale",
                "inputs": {
                    "upscale_method": "nearest-exact",
                    "width": 1024,
                    "height": 1024,
                    "crop": "disabled",
                    "image": ["7", 0]
                }
            };
            prompt["9"] = {
                "class_type": "ImageToMask",
                "inputs": { "channel": "red", "image": ["8", 0] }
            };
            maskSourceNode = "9";
            maskIndex = 0;
        } else {
            prompt["10"] = {
                "class_type": "GroundingDinoModelLoader (segment anything2)",
                "inputs": { "model_name": "GroundingDINO_SwinT_OGC (694MB)" }
            };
            prompt["11"] = {
                "class_type": "SAM2ModelLoader (segment anything2)",
                "inputs": { "model_name": "sam2_1_hiera_base_plus.pt" }
            };
            prompt["12"] = {
                "class_type": "GroundingDinoSAM2Segment (segment anything2)",
                "inputs": {
                    "sam_model": ["11", 0],
                    "grounding_dino_model": ["10", 0],
                    "image": ["2", 0],
                    "prompt": placementHint || "ground, table, empty space, sky",
                    "threshold": 0.3,
                    "keep_model_loaded": false
                }
            };
            maskSourceNode = "12";
            maskIndex = 1;
        }

        // SetLatentNoiseMask pattern as requested
        prompt["13"] = {
            "class_type": "SetLatentNoiseMask",
            "inputs": {
                "samples": ["6", 0],
                "mask": [maskSourceNode, maskIndex]
            }
        };

        // KSampler
        prompt["14"] = {
            "class_type": "KSampler",
            "inputs": {
                "seed": Math.floor(Math.random() * 10000000),
                "steps": 40,
                "cfg": 7.0,
                "sampler_name": "dpmpp_2m",
                "scheduler": "karras",
                "denoise": 0.95,
                "model": ["3", 0],
                "positive": ["4", 0],
                "negative": ["5", 0],
                "latent_image": ["13", 0]
            }
        };

        prompt["15"] = {
            "class_type": "VAEDecode",
            "inputs": { "samples": ["14", 0], "vae": ["3", 2] }
        };

        prompt["16"] = {
            "class_type": "SaveImage",
            "inputs": {
                "filename_prefix": "pixxel_fusion",
                "images": ["15", 0]
            }
        };

        const promptId = await submitWorkflow(prompt);
        const resultFilename = await waitForResult(promptId);
        const finalImageBase64 = await getResultImage(resultFilename);

        return NextResponse.json({ success: true, result: finalImageBase64 });

    } catch (err) {
        console.error("Fusion API Error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
