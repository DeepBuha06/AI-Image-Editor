import React, { useState } from 'react';
import { Mic, Activity, Loader2 } from 'lucide-react';

export default function PromptBar({ editPrompt, setEditPrompt, selectedMode, onAutoDetect }) {
    const [isListening, setIsListening] = useState(false);
    const [isDetecting, setIsDetecting] = useState(false);

    const getPlaceholder = () => {
        switch (selectedMode) {
            case "edit": return "e.g. 'a bright red shirt, silky texture'";
            case "remove": return "e.g. 'remove the car, rebuild background'";
            case "fusion": return "e.g. 'add a wooden coffee table'";
            case "sketch": return "e.g. 'a medieval sword'";
            default: return "Describe your edit...";
        }
    };

    const handleMicClick = () => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert("Your browser does not support the Web Speech API. Try Chrome or Edge.");
            return;
        }

        if (isListening) return; // Prevent double trigger

        setIsListening(true);
        const recognition = new SpeechRecognition();
        recognition.lang = 'en-US';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            setEditPrompt(prev => prev ? `${prev} ${transcript}` : transcript);
            setIsListening(false);
        };

        recognition.onerror = (event) => {
            console.error("Speech error", event.error);
            setIsListening(false);
        };

        recognition.onend = () => {
            setIsListening(false);
        };

        recognition.start();
    };

    const handleAutoDetect = async () => {
        if (!editPrompt.trim()) return;
        setIsDetecting(true);
        try {
            await onAutoDetect(editPrompt);
        } finally {
            setIsDetecting(false);
        }
    };

    return (
        <div>
            <div className="flex justify-between items-center mb-1 block">
                <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">3 · Edit Instruction</span>
                <button
                    onClick={handleAutoDetect}
                    disabled={isDetecting || !editPrompt}
                    className="text-[9px] bg-neutral-800 text-cyan-300 px-2 py-0.5 rounded-full hover:bg-neutral-700 disabled:opacity-50 flex items-center gap-1 transition"
                >
                    {isDetecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                    Auto-Route Intent
                </button>
            </div>
            <div className="relative">
                <textarea
                    placeholder={getPlaceholder()}
                    value={editPrompt}
                    onChange={(e) => setEditPrompt(e.target.value)}
                    rows={3}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40 resize-none placeholder:text-neutral-600 pr-10"
                />
                <button
                    onClick={handleMicClick}
                    title="Dictate prompt"
                    className={`absolute bottom-3 right-3 p-1.5 rounded-md transition ${isListening ? 'bg-red-500/20 text-red-500 animate-pulse' : 'bg-neutral-900 text-neutral-400 hover:text-white hover:bg-neutral-800'}`}
                >
                    <Mic className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}
