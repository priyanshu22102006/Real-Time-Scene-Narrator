import React, { useCallback, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { speakText, stopSpeech } from '../utils/tts';

interface TaskResult {
  extractedText: string;
  address: string | null;
  rawDescription: string;
}

interface TaskModeProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  isCameraActive: boolean;
  onAddressFound?: (address: string) => void;
}

export default function TaskMode({ videoRef, isCameraActive, onAddressFound }: TaskModeProps) {
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<TaskResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      setErrorMessage('Camera is not ready. Please ensure camera access is granted.');
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    setCapturedImage(dataUrl);
    setResult(null);
    setErrorMessage(null);

    canvas.toBlob((blob) => {
      if (blob) setCapturedBlob(blob);
    }, 'image/jpeg', 0.85);

    speakText('Photo captured. Tap Analyze to read text with Gemini AI.');
  }, [videoRef]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErrorMessage('Please upload an image file (JPEG, PNG, WebP).');
      return;
    }

    setCapturedBlob(file);
    setResult(null);
    setErrorMessage(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setCapturedImage(dataUrl);
      speakText('Image loaded. Tap Analyze to read text with Gemini AI.');
    };
    reader.readAsDataURL(file);
  }, []);

  const analyzeImage = useCallback(async () => {
    if (!capturedBlob) {
      setErrorMessage('Please capture or upload an image first.');
      return;
    }

    setIsAnalyzing(true);
    setErrorMessage(null);
    speakText('Analyzing image with Gemini Vision. Please wait.');

    try {
      const formData = new FormData();
      formData.append('image', capturedBlob, 'task-image.jpg');

      const response = await axios.post<TaskResult>(
        '/api/extract-address',
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 25000,
        }
      );

      setResult(response.data);

      const toSpeak = response.data.extractedText || 'No text found in image.';
      speakText(toSpeak);

      if (response.data.address && onAddressFound) {
        setTimeout(() => {
          speakText(`Address detected: ${response.data.address}. Tap Navigate to get directions.`);
        }, 1500);
      }

    } catch (err: unknown) {
      let message = 'Failed to analyze image with Gemini API.';
      if (axios.isAxiosError(err)) {
        if (err.response?.data?.error) {
          message = err.response.data.error;
        }
      }
      setErrorMessage(message);
      speakText('Error analyzing image. ' + message);
    } finally {
      setIsAnalyzing(false);
    }
  }, [capturedBlob, onAddressFound]);

  const clearImage = useCallback(() => {
    setCapturedImage(null);
    setCapturedBlob(null);
    setResult(null);
    setErrorMessage(null);
    stopSpeech();
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  return (
    <div className="flex flex-col gap-6" role="region" aria-label="Task mode: text and address extraction">
      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileUpload}
        className="hidden"
        id="task-file-input"
      />

      <div className="flex flex-wrap gap-3" role="group" aria-label="Image source selection">
        <button
          onClick={capturePhoto}
          disabled={!isCameraActive}
          className="flex-1 flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white font-semibold py-3 px-4 rounded-xl transition-all duration-200 hover:scale-105 disabled:scale-100 text-sm"
        >
          📷 Capture Photo
        </button>
        <label
          htmlFor="task-file-input"
          className="flex-1 flex items-center justify-center gap-2 bg-gray-600 hover:bg-gray-700 text-white font-semibold py-3 px-4 rounded-xl transition-all duration-200 hover:scale-105 cursor-pointer text-sm"
          role="button"
          tabIndex={0}
        >
          📁 Upload Image
        </label>
      </div>

      <AnimatePresence>
        {capturedImage && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="relative rounded-xl overflow-hidden border-2 border-primary-200 dark:border-primary-800"
          >
            <img
              src={capturedImage}
              alt="Captured or uploaded image for analysis"
              className="w-full object-cover max-h-64"
            />
            <button
              onClick={clearImage}
              className="absolute top-2 right-2 w-8 h-8 bg-black/60 hover:bg-black/80 text-white rounded-full flex items-center justify-center text-sm transition-colors"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {errorMessage && (
        <div role="alert" className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
          ⚠️ {errorMessage}
        </div>
      )}

      {capturedImage && (
        <button
          onClick={analyzeImage}
          disabled={isAnalyzing || !capturedBlob}
          className="flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200 hover:scale-105 disabled:scale-100"
        >
          {isAnalyzing ? '⏳ Gemini AI Analyzing...' : '🔍 Read Text & Address (Gemini AI)'}
        </button>
      )}

      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-4"
          >
            <div className="p-5 rounded-xl bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-violet-500 dark:text-violet-400 uppercase tracking-wide">
                  Gemini OCR Extracted Text
                </p>
                <span className="text-xs font-medium text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-900/40 px-2 py-0.5 rounded-full">
                  🔊 ElevenLabs Voice
                </span>
              </div>
              <p className="text-gray-800 dark:text-gray-200 text-sm leading-relaxed font-medium">
                {result.extractedText}
              </p>
            </div>

            {result.address && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="p-5 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800"
              >
                <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mb-2 uppercase tracking-wide">
                  📍 Physical Address Identified
                </p>
                <p className="text-gray-800 dark:text-gray-200 font-bold text-base mb-3">
                  {result.address}
                </p>
                {onAddressFound && (
                  <button
                    onClick={() => onAddressFound(result.address!)}
                    className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2.5 px-5 rounded-lg transition-all duration-200 hover:scale-105 text-sm"
                  >
                    🗺️ Navigate to Address
                  </button>
                )}
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
        Powered by <strong>Google Gemini 1.5 Flash OCR</strong> &amp; <strong>ElevenLabs AI Voice Studio</strong>.
      </p>
    </div>
  );
}
