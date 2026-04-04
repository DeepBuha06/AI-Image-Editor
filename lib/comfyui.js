export async function uploadImage(base64Image, type = "image") {
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    const formData = new FormData();
    const filename = `${type}_${Date.now()}.png`;

    formData.append("image", new Blob([buffer], { type: "image/png" }), filename);

    const res = await fetch("http://10.0.62.179:8189/upload/image", {
        method: "POST",
        body: formData
    });

    if (!res.ok) throw new Error("Failed to upload image");
    const data = await res.json();
    return data.name;
}

export async function submitWorkflow(prompt) {
    const res = await fetch("http://10.0.62.179:8189/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt })
    });

    if (!res.ok) throw new Error("Failed to submit workflow");
    const data = await res.json();
    return data.prompt_id;
}

export async function waitForResult(promptId) {
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const interval = setInterval(async () => {
            attempts++;
            if (attempts > 180) { // 3 minutes timeout
                clearInterval(interval);
                return reject(new Error("Workflow execution timed out"));
            }

            try {
                const res = await fetch(`http://10.0.62.179:8189/history/${promptId}`);
                const data = await res.json();

                if (data && data[promptId]) {
                    clearInterval(interval);
                    const outputs = data[promptId].outputs;

                    // Find the first node output that contains images
                    let outputFilename = null;
                    for (const nodeId in outputs) {
                        if (outputs[nodeId].images && outputs[nodeId].images.length > 0) {
                            outputFilename = outputs[nodeId].images[0].filename;
                            break;
                        }
                    }

                    if (outputFilename) {
                        resolve(outputFilename);
                    } else {
                        reject(new Error("Workflow completed but no image was saved"));
                    }
                }
            } catch (e) {
                // Silently continue polling on network errors
            }
        }, 1000); // poll every 1s
    });
}

export async function getResultImage(filename) {
    const res = await fetch(`http://10.0.62.179:8189/view?filename=${filename}`);
    if (!res.ok) throw new Error("Failed to fetch result image");
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return `data:image/png;base64,${buffer.toString("base64")}`;
}
