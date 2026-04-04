"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Upload, Sparkles, Loader2, CheckCircle2, CopyPlus, Undo2 } from "lucide-react";

import ModeSelector from "./components/ModeSelector";
import PromptBar from "./components/PromptBar";
import SketchCanvas from "./components/SketchCanvas";
import BeforeAfter from "./components/BeforeAfter";
import EditHistory from "./components/EditHistory";

export default function Page() {
    const [mode, setMode] = useState("edit");
    const [imageDataUrl, setImageDataUrl] = useState(null);
    const [targetObject, setTargetObject] = useState("");
    const [editPrompt, setEditPrompt] = useState("");
    const [editStrength, setEditStrength] = useState(0.95);
    const [isProcessing, setIsProcessing] = useState(false);
    const [resultImage, setResultImage] = useState(null);
    const [brushSize, setBrushSize] = useState(30);
    const [history, setHistory] = useState([]);
    const [confidenceBadge, setConfidenceBadge] = useState("");

    const canvasRef = useRef(null);
    const isDrawing = useRef(false);
    const imgRef = useRef(null);
    const pathsRef = useRef([]);
    const sketchCanvasRef = useRef(null);

    // Load the uploaded image into an HTMLImageElement + Downscale
    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const rawDataUrl = ev.target.result;
            const img = new Image();
            img.onload = () => {
                let width = img.naturalWidth;
                let height = img.naturalHeight;
                const MAX_SIZE = 1024;

                if (width > MAX_SIZE || height > MAX_SIZE) {
                    if (width > height) {
                        height = Math.round((height * MAX_SIZE) / width);
                        width = MAX_SIZE;
                    } else {
                        width = Math.round((width * MAX_SIZE) / height);
                        height = MAX_SIZE;
                    }
                }

                const tempCanvas = document.createElement("canvas");
                tempCanvas.width = width;
                tempCanvas.height = height;
                const ctx = tempCanvas.getContext("2d");
                ctx.drawImage(img, 0, 0, width, height);
                const resizedDataUrl = tempCanvas.toDataURL("image/png");

                setImageDataUrl(resizedDataUrl);
                setResultImage(null);
                setHistory([]);
                pathsRef.current = [];

                const resizedImg = new Image();
                resizedImg.onload = () => {
                    imgRef.current = resizedImg;
                    if (mode === "edit" || mode === "remove" || mode === "fusion") {
                        drawCanvasWithImage(resizedImg);
                    }
                };
                resizedImg.src = resizedDataUrl;
            };
            img.src = rawDataUrl;
        };
        reader.readAsDataURL(file);
    };

    const drawCanvasWithImage = useCallback((img) => {
        const canvas = canvasRef.current;
        if (!canvas || !img) return;
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);

        for (const path of pathsRef.current) {
            ctx.strokeStyle = "rgba(255, 0, 0, 0.5)";
            ctx.lineWidth = path.size;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.beginPath();
            for (let i = 0; i < path.points.length; i++) {
                const p = path.points[i];
                if (i === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
        }
    }, []);

    useEffect(() => {
        if (imgRef.current && mode !== "sketch") {
            setTimeout(() => drawCanvasWithImage(imgRef.current), 50);
        }
    }, [mode, imageDataUrl, drawCanvasWithImage]);

    const getCanvasCoords = (e) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY,
        };
    };

    const onPointerDown = (e) => {
        isDrawing.current = true;
        const p = getCanvasCoords(e);
        pathsRef.current.push({ points: [p], size: brushSize });
    };

    const onPointerMove = (e) => {
        if (!isDrawing.current) return;
        const p = getCanvasCoords(e);
        const currentPath = pathsRef.current[pathsRef.current.length - 1];
        currentPath.points.push(p);

        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        ctx.strokeStyle = "rgba(255, 0, 0, 0.5)";
        ctx.lineWidth = brushSize;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        const pts = currentPath.points;
        if (pts.length >= 2) {
            ctx.beginPath();
            ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
            ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
            ctx.stroke();
        }
    };

    const onPointerUp = () => {
        isDrawing.current = false;
    };

    const handleUndo = () => {
        pathsRef.current.pop();
        if (imgRef.current) drawCanvasWithImage(imgRef.current);
    };

    const extractMask = () => {
        const img = imgRef.current;
        if (!img || pathsRef.current.length === 0) return null;
        const offscreen = document.createElement("canvas");
        offscreen.width = img.naturalWidth;
        offscreen.height = img.naturalHeight;
        const ctx = offscreen.getContext("2d");

        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, offscreen.width, offscreen.height);

        for (const path of pathsRef.current) {
            ctx.strokeStyle = "white";
            ctx.lineWidth = path.size;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.beginPath();
            for (let i = 0; i < path.points.length; i++) {
                const p = path.points[i];
                if (i === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
        }
        return offscreen.toDataURL("image/png");
    };

    const handleAutoDetect = async (promptText) => {
        setIsProcessing(true);
        try {
            const res = await fetch("/api/intent", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt: promptText })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Intent detection failed");

            let newMode = "edit";
            if (data.type === "object_removal") newMode = "remove";
            else if (data.type === "object_fusion") newMode = "fusion";
            else if (data.type === "sketch_to_object") newMode = "sketch";

            setMode(newMode);
            if (data.targetObject) setTargetObject(data.targetObject);

            setConfidenceBadge(`Auto-detected: ${Math.round(data.confidence * 100)}% confidence`);
            setTimeout(() => setConfidenceBadge(""), 4000);

        } catch (err) {
            alert(err.message || "Intent detection failed.");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleExecute = async () => {
        if (!imageDataUrl || !editPrompt) {
            alert("Upload an image and enter an edit instruction.");
            return;
        }

        setIsProcessing(true);
        try {
            const body = { image: imageDataUrl, editPrompt };
            let endpoint = "/api/comfyui";

            if (mode === "edit") {
                body.mode = pathsRef.current.length ? "brush" : "auto";
                body.editStrength = editStrength;
                if (body.mode === "auto") {
                    if (!targetObject.trim()) throw new Error("Please enter an Auto Target Object manually or draw a brush mask.");
                    body.targetObject = targetObject;
                } else {
                    body.mask = extractMask();
                }
            } else if (mode === "remove") {
                endpoint = "/api/removal";
                body.mode = pathsRef.current.length ? "brush" : "auto";
                body.mask = extractMask();
                if (body.mode === "auto") {
                    if (!targetObject.trim()) throw new Error("Please enter an Auto Target Object manually or draw a brush mask.");
                    body.targetObject = targetObject;
                }
            } else if (mode === "fusion") {
                endpoint = "/api/fusion";
                body.mode = "fusion";
                body.addPrompt = editPrompt;
                body.placementHint = ""; // Required payload argument
                body.mask = extractMask();
            } else if (mode === "sketch") {
                endpoint = "/api/sketch";
                body.mode = "sketch";
                const sketchB64 = sketchCanvasRef.current?.getSketch();
                if (!sketchB64) throw new Error("Please draw a sketch first");
                body.sketch = sketchB64;
                body.sketchPrompt = editPrompt;
            }

            const res = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Processing failed");

            const finalResponseImage = data.image || data.result;

            setResultImage(finalResponseImage);
            setHistory(prev => [{ prompt: editPrompt, image: finalResponseImage }, ...prev].slice(0, 5));
        } catch (err) {
            alert(err.message);
            console.error(err);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleUseResultAsNewInput = () => {
        if (!resultImage) return;
        setImageDataUrl(resultImage);
        setResultImage(null);
        pathsRef.current = [];
        const img = new Image();
        img.onload = () => {
            imgRef.current = img;
            if (mode !== "sketch") drawCanvasWithImage(img);
        };
        img.src = resultImage;
    };

    const handleRestoreHistory = (historicalImg) => {
        setResultImage(historicalImg);
    };

    return (
        <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-row p-6 gap-6 font-sans">
            {/* ───── Sidebar ───── */}
            <div className="w-[400px] shrink-0 flex flex-col gap-5 bg-neutral-900 border border-neutral-800 rounded-2xl p-5 shadow-2xl overflow-y-auto max-h-screen custom-scrollbar">
                <div className="flex items-center gap-3">
                    <Sparkles className="text-cyan-400 w-6 h-6" />
                    <h1 className="text-xl font-bold tracking-tight">PIXXEL AI</h1>
                    {confidenceBadge && (
                        <span className="ml-auto flex items-center gap-1 text-[9px] bg-green-500/20 text-green-400 px-2 py-1 rounded border border-green-500/30">
                            <CheckCircle2 className="w-3 h-3" /> {confidenceBadge}
                        </span>
                    )}
                </div>

                <ModeSelector selectedMode={mode} onModeChange={setMode} />

                <div>
                    <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1 block">2 · Image Base</span>
                    <label htmlFor="pixxel-upload" className="flex items-center justify-center w-full h-16 bg-neutral-950 border-2 border-dashed border-neutral-700 rounded-xl cursor-pointer hover:border-cyan-500/50 transition">
                        <Upload className="w-4 h-4 text-neutral-500 mr-2" />
                        <span className="text-sm text-neutral-400">{imageDataUrl ? "Change base image" : "Upload image"}</span>
                    </label>
                    <input id="pixxel-upload" type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                </div>

                {(mode === "edit" || mode === "remove" || mode === "fusion") && (
                    <div className="flex items-center gap-3 bg-neutral-950 p-2 rounded-lg border border-neutral-800">
                        <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">Mask Brush Layer</span>
                        <input type="range" min="5" max="100" value={brushSize}
                            onChange={(e) => setBrushSize(parseInt(e.target.value))}
                            className="flex-1 accent-purple-500" />
                        <button onClick={handleUndo} title="Undo stroke"
                            className="p-1 rounded-md bg-neutral-800 hover:bg-neutral-700 transition">
                            <Undo2 className="w-3.5 h-3.5 text-neutral-300" />
                        </button>
                    </div>
                )}

                {(mode === "edit" || mode === "remove") && (
                    <div>
                        <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1 block">Auto Target Object</span>
                        <input type="text" placeholder="Object name (e.g. shirt, car)" maxLength={30}
                            value={targetObject} onChange={(e) => setTargetObject(e.target.value)}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/40 placeholder:text-neutral-600" />
                    </div>
                )}

                <PromptBar
                    editPrompt={editPrompt}
                    setEditPrompt={setEditPrompt}
                    selectedMode={mode}
                    onAutoDetect={handleAutoDetect}
                />

                {mode === "edit" && (
                    <div>
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">Edit Strength</span>
                            <span className="text-xs text-cyan-400 font-mono">{editStrength.toFixed(2)}</span>
                        </div>
                        <input type="range" min="0.3" max="1.0" step="0.05" value={editStrength}
                            onChange={(e) => setEditStrength(parseFloat(e.target.value))}
                            className="w-full accent-cyan-500" />
                    </div>
                )}

                <EditHistory history={history} onRestore={handleRestoreHistory} />

                <div className="mt-auto flex flex-col gap-2">
                    <button onClick={handleExecute}
                        disabled={!imageDataUrl || !editPrompt || isProcessing}
                        className="w-full bg-gradient-to-r from-cyan-600 to-purple-600 hover:from-cyan-500 hover:to-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-4 py-3 shadow-lg transition flex items-center justify-center gap-2">
                        {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                        {isProcessing ? "Processing…" : `Run ${mode} Edit`}
                    </button>

                    {resultImage && (
                        <button onClick={handleUseResultAsNewInput}
                            className="w-full bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-semibold rounded-lg px-4 py-2 transition flex items-center justify-center gap-2">
                            <CopyPlus className="w-3.5 h-3.5" /> Use Result As New Base
                        </button>
                    )}
                </div>
            </div>

            {/* ───── Canvas Area ───── */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative border border-neutral-800 rounded-2xl bg-neutral-900 border-dashed">
                {resultImage ? (
                    <BeforeAfter originalSrc={imageDataUrl} resultSrc={resultImage} />
                ) : (
                    <div className="flex-1 flex items-center justify-center p-4 relative overflow-hidden">
                        {!imageDataUrl ? (
                            <span className="text-neutral-600 text-sm">Upload an image to start</span>
                        ) : (
                            <div className="relative inline-block max-w-full max-h-full">
                                {mode === "sketch" ? (
                                    <>
                                        <img src={imageDataUrl} alt="Base" className="max-w-full max-h-full object-contain rounded-lg opacity-40" />
                                        <SketchCanvas ref={sketchCanvasRef} baseImageWidth={imgRef.current?.naturalWidth} baseImageHeight={imgRef.current?.naturalHeight} />
                                    </>
                                ) : (
                                    <canvas
                                        ref={canvasRef}
                                        onPointerDown={onPointerDown}
                                        onPointerMove={onPointerMove}
                                        onPointerUp={onPointerUp}
                                        onPointerLeave={onPointerUp}
                                        className="max-w-full max-h-full object-contain rounded-lg cursor-crosshair"
                                        style={{ touchAction: "none" }}
                                    />
                                )}
                            </div>
                        )}
                        {isProcessing && (
                            <div className="absolute inset-0 bg-black/60 flex items-center justify-center backdrop-blur-sm z-50">
                                <div className="flex flex-col items-center gap-3">
                                    <Loader2 className="w-8 h-8 text-cyan-500 animate-spin" />
                                    <span className="text-xs text-cyan-500/80 uppercase tracking-widest">Generating…</span>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
            <style jsx global>{`
                .custom-scrollbar::-webkit-scrollbar { width: 4px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 4px; }
            `}</style>
        </div>
    );
}
