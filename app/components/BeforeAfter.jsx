import React, { useState, useRef, useEffect } from 'react';

export default function BeforeAfter({ originalSrc, resultSrc }) {
    const [sliderPos, setSliderPos] = useState(50);
    const containerRef = useRef(null);
    const isDragging = useRef(false);

    const handlePointerMove = (e) => {
        if (!isDragging.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        let x = e.clientX - rect.left;
        x = Math.max(0, Math.min(x, rect.width));
        setSliderPos((x / rect.width) * 100);
    };

    const stopDragging = () => { isDragging.current = false; };
    const startDragging = () => { isDragging.current = true; };

    useEffect(() => {
        window.addEventListener('pointerup', stopDragging);
        return () => window.removeEventListener('pointerup', stopDragging);
    }, []);

    return (
        <div
            ref={containerRef}
            className="relative w-full h-full flex items-center justify-center overflow-hidden rounded-lg bg-neutral-900 select-none cursor-ew-resize border border-cyan-900/40"
            onPointerMove={handlePointerMove}
            onPointerDown={startDragging}
            onPointerLeave={stopDragging}
            style={{ touchAction: 'none' }}
        >
            {/* Base Image (Result) */}
            <img src={resultSrc} alt="Result" className="absolute max-w-full max-h-full object-contain pointer-events-none" />

            {/* Reveal Image (Original) */}
            <div
                className="absolute inset-0 overflow-hidden flex items-center justify-center pointer-events-none"
                style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
            >
                <img src={originalSrc} alt="Original" className="max-w-full max-h-full object-contain" />
            </div>

            {/* Slider Handle */}
            <div
                className="absolute top-0 bottom-0 w-0.5 bg-white pointer-events-none shadow-[0_0_10px_rgba(0,0,0,0.5)] z-10"
                style={{ left: `${sliderPos}%` }}
            >
                <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-lg">
                    <div className="flex gap-1">
                        <div className="w-0.5 h-3 bg-neutral-400 rounded-full"></div>
                        <div className="w-0.5 h-3 bg-neutral-400 rounded-full"></div>
                    </div>
                </div>
            </div>

            {/* Labels */}
            <div className="absolute top-3 left-3 bg-black/60 text-white text-[10px] font-bold px-2 py-1 rounded backdrop-blur-sm pointer-events-none">ORIGINAL</div>
            <div className="absolute top-3 right-3 bg-cyan-900/80 text-cyan-200 text-[10px] font-bold px-2 py-1 rounded backdrop-blur-sm pointer-events-none">RESULT</div>
        </div>
    );
}
