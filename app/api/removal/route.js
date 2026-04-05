import { NextResponse } from "next/server";
import { uploadImage, submitWorkflow, waitForResult, getResultImage } from "../../../lib/comfyui";

export async function POST(req) {
    try {
        const { image, mask, targetObject, mode } = await req.json();

        if (!image) {
            return NextResponse.json({ error: "Missing image" }, { status: 400 });
        }

        const uploadedImage = await uploadImage(image, "input");

        // Build the workflow
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
            }
        };

        let maskSourceNode = null;

        if (mode === "auto" && targetObject) {
            // Auto masking with GroundingDINO + SAM2
            prompt["3"] = {
                "class_type": "GroundingDinoModelLoader (segment anything2)",
                "inputs": { "model_name": "GroundingDINO_SwinT_OGC (694MB)" }
            };
            prompt["4"] = {
                "class_type": "SAM2ModelLoader (segment anything2)",
                "inputs": { "model_name": "sam2_1_hiera_base_plus.pt" }
            };
            prompt["5"] = {
                "class_type": "GroundingDinoSAM2Segment (segment anything2)",
                "inputs": {
                    "prompt": targetObject,
                    "threshold": 0.3,
                    "sam_model": ["4", 0],
                    "image": ["2", 0],
                    "grounding_dino_model": ["3", 0],
                    "keep_model_loaded": false
                }
            };
            maskSourceNode = "5";
            var maskIndex = 1; // GroundingDinoSAM2Segment mask output is index 1
        } else if (mode === "brush" && mask) {
            // Brush masking
            const uploadedMask = await uploadImage(mask, "mask");
            prompt["6"] = {
                "class_type": "LoadImage",
                "inputs": { "image": uploadedMask }
            };
            prompt["7"] = {
                "class_type": "ImageScale",
                "inputs": {
                    "upscale_method": "nearest-exact",
                    "width": 1024,
                    "height": 1024,
                    "crop": "disabled",
                    "image": ["6", 0]
                }
            };
            prompt["8"] = {
                "class_type": "ImageToMask",
                "inputs": { "channel": "red", "image": ["7", 0] }
            };
            maskSourceNode = "8";
            var maskIndex = 0; // ImageToMask mask output is index 0
        } else {
            return NextResponse.json({ error: "Invalid mode or missing mask/targetObject" }, { status: 400 });
        }

        // LaMa Remover node for clean erasing
        prompt["9"] = {
            "class_type": "LamaRemover",
            "inputs": {
                "images": ["2", 0],
                "masks": [maskSourceNode, maskIndex],
                "invert_mask": false,
                "mask_threshold": 200,
                "gaussblur_radius": 4
            }
        };

        // Save final image
        prompt["10"] = {
            "class_type": "SaveImage",
            "inputs": {
                "filename_prefix": "pixxel_removal",
                "images": ["9", 0]
            }
        };

        // Execute the workflow
        const prompt_id = await submitWorkflow(prompt);
        const resultInfo = await waitForResult(prompt_id);
        const finalImage = await getResultImage(resultInfo.filename, resultInfo.subfolder, resultInfo.type);

        return NextResponse.json({ success: true, image: finalImage });

    } catch (err) {
        console.error("Removal API Error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
