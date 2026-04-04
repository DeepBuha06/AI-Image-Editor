import React, { useRef, useImperativeHandle, forwardRef, useEffect } from 'react';
import { Trash2 } from 'lucide-react';

const SketchCanvas = forwardRef(({ baseImageWidth, baseImageHeight }, ref) => {
    const canvasRef = useRef(null);
    const isDrawing = useRef(false);

    useImperativeHandle(ref, () => ({
        getSketch: () => {
            const canvas = canvasRef.current;
            if (!canvas) return null;
            return canvas.toDataURL('image/png');
        },
        clear: () => clearCanvas()
    }));

    useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas && baseImageWidth && baseImageHeight) {
            canvas.width = baseImageWidth;
            canvas.height = baseImageHeight;
            clearCanvas(); // Initialize black background
        }
    }, [baseImageWidth, baseImageHeight]);

    const clearCanvas = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    };

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
        const ctx = canvasRef.current.getContext("2d");
        ctx.strokeStyle = "white";
        ctx.lineWidth = 15;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
    };

    const onPointerMove = (e) => {
        if (!isDrawing.current) return;
        const p = getCanvasCoords(e);
        const ctx = canvasRef.current.getContext("2d");
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
    };

    const onPointerUp = () => {
        if (!isDrawing.current) return;
        const ctx = canvasRef.current.getContext("2d");
        ctx.closePath();
        isDrawing.current = false;
    };

    return (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-sm rounded-lg overflow-hidden group">
            <button
                onClick={clearCanvas}
                className="absolute top-2 right-2 bg-neutral-900/80 text-white p-2 rounded z-30 hover:bg-neutral-800 transition"
                title="Clear Sketch"
            >
                <Trash2 className="w-4 h-4" />
            </button>
            <span className="absolute top-2 left-2 bg-black/80 text-purple-400 text-[10px] uppercase font-bold px-2 py-1 rounded z-30">
                Sketch Mode
            </span>
            <canvas
                ref={canvasRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
                className="max-w-full max-h-full object-contain cursor-crosshair mix-blend-screen opacity-80"
                style={{ touchAction: "none" }}
            />
        </div>
    );
});

SketchCanvas.displayName = "SketchCanvas";
export default SketchCanvas;
