import React, { useCallback, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { speakText, stopSpeech } from '../utils/tts';

interface TaskResult {
  extractedText: string;
  address: string | null;
  rawDescription?: string;
  provider?: string;
}

interface TaskModeProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  isCameraActive: boolean;
  onAddressFound?: (address: string) => void;
}

/**
 * Enhances canvas image contrast and sharpness before OCR extraction.
 */
function enhanceImageContrast(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
) {
  try {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // Apply mild contrast stretch (1.15 multiplier)
    const factor = 1.15;
    for (let i = 0; i < data.length; i += 4) {
      data[i]     = Math.min(255, Math.max(0, (data[i]     - 128) * factor + 128));
      data[i + 1] = Math.min(255, Math.max(0, (data[i + 1] - 128) * factor + 128));
      data[i + 2] = Math.min(255, Math.max(0, (data[i + 2] - 128) * factor + 128));
    }
    ctx.putImageData(imageData, 0, 0);
  } catch (err) {
    // Cross-origin canvas security fallback — ignore enhancement if restricted
  }
}

export default function TaskMode({ videoRef, isCameraActive, onAddressFound }: TaskModeProps) {
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<TaskResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      setErrorMessage('Camera is not ready. Please make sure camera is enabled.');
      speakText('Camera is not ready. Please start camera first.');
      return;
    }

    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, w, h);
    enhanceImageContrast(ctx, w, h);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.90);
    setCapturedImage(dataUrl);
    setResult(null);
    setErrorMessage(null);
    setCopiedText(false);

    canvas.toBlob((blob) => {
      if (blob) setCapturedBlob(blob);
    }, 'image/jpeg', 0.90);

    speakText('Photo captured. Tap Analyze to read text with Gemini AI.');
  }, [videoRef]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErrorMessage('Please upload a valid image file (JPEG, PNG, WebP).');
      return;
    }

    setCapturedBlob(file);
    setResult(null);
    setErrorMessage(null);
    setCopiedText(false);

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
      setErrorMessage('Please capture a photo or upload an image first.');
      speakText('Please capture a photo first.');
      return;
    }

    setIsAnalyzing(true);
    setErrorMessage(null);
    speakText('Reading text with Gemini AI. Please wait.');

    try {
      const formData = new FormData();
      formData.append('image', capturedBlob, 'ocr-task.jpg');

      const response = await axios.post<TaskResult>(
        '/api/extract-address',
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 25000,
        }
      );

      const data = response.data;
      setResult(data);

      const textToRead = data.extractedText || 'No readable text found in this image.';
      speakText(textToRead);

      if (data.address && onAddressFound) {
        setTimeout(() => {
          speakText(`Address found: ${data.address}. Tap Navigate to get turn by turn directions.`);
        }, 2000);
      }

    } catch (err: unknown) {
      let message = 'Failed to process image for text extraction. Please try again.';
      if (axios.isAxiosError(err)) {
        if (err.response?.data?.error) {
          message = err.response.data.error;
        } else if (err.code === 'ECONNABORTED') {
          message = 'Text analysis request timed out. Please try again.';
        }
      }
      setErrorMessage(message);
      speakText('Error reading text. ' + message);
    } finally {
      setIsAnalyzing(false);
    }
  }, [capturedBlob, onAddressFound]);

  const replayText = useCallback(() => {
    if (result?.extractedText) {
      speakText(result.extractedText);
    }
  }, [result]);

  const copyToClipboard = useCallback(() => {
    if (result?.extractedText) {
      navigator.clipboard.writeText(result.extractedText);
      setCopiedText(true);
      speakText('Text copied to clipboard.');
      setTimeout(() => setCopiedText(false), 3000);
    }
  }, [result]);

  const clearImage = useCallback(() => {
    setCapturedImage(null);
    setCapturedBlob(null);
    setResult(null);
    setErrorMessage(null);
    setCopiedText(false);
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

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-3" role="group" aria-label="Image capture options">
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

      {/* Image Preview */}
      <AnimatePresence>
        {capturedImage && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="relative rounded-xl overflow-hidden border-2 border-primary-300 dark:border-primary-700"
          >
            <img
              src={capturedImage}
              alt="Captured frame for OCR text extraction"
              className="w-full object-cover max-h-64"
            />
            <button
              onClick={clearImage}
              className="absolute top-2 right-2 w-8 h-8 bg-black/70 hover:bg-black text-white rounded-full flex items-center justify-center text-sm transition-colors shadow-lg"
              title="Clear photo"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error display */}
      {errorMessage && (
        <div role="alert" className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm flex flex-col gap-2">
          <div className="flex items-center gap-2 font-medium">
            <span>⚠️ {errorMessage}</span>
          </div>
          <p className="text-xs text-red-600 dark:text-red-400">
            Tip: Hold camera steady, ensure good lighting, and center text in frame.
          </p>
        </div>
      )}

      {/* Analyze Button */}
      {capturedImage && (
        <button
          onClick={analyzeImage}
          disabled={isAnalyzing || !capturedBlob}
          className="flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white font-semibold py-3.5 px-6 rounded-xl transition-all duration-200 hover:scale-105 disabled:scale-100 shadow-md"
        >
          {isAnalyzing ? '⏳ Gemini OCR Analyzing Text...' : '🔍 Read Text & Extract Address (Gemini AI)'}
        </button>
      )}

      {/* Extracted Text Results */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-4"
          >
            <div className="p-5 rounded-xl bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <p className="text-xs font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wide">
                  📄 Extracted Text
                </p>
                <div className="flex items-center gap-2">
                  {result.provider && (
                    <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/40 px-2 py-0.5 rounded-full">
                      ✓ {result.provider}
                    </span>
                  )}
                  <button
                    onClick={replayText}
                    className="text-xs font-semibold text-violet-700 dark:text-violet-300 hover:underline flex items-center gap-1 bg-violet-100 dark:bg-violet-800/50 px-2 py-1 rounded-md"
                    title="Speak text again"
                  >
                    🔊 Read Aloud
                  </button>
                  <button
                    onClick={copyToClipboard}
                    className="text-xs font-semibold text-gray-700 dark:text-gray-300 hover:underline flex items-center gap-1 bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded-md"
                    title="Copy text"
                  >
                    {copiedText ? '✓ Copied' : '📋 Copy'}
                  </button>
                </div>
              </div>

              <p className="text-gray-800 dark:text-gray-200 text-sm leading-relaxed font-medium whitespace-pre-wrap">
                {result.extractedText}
              </p>
            </div>

            {/* Address Identified Badge */}
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
                    className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2.5 px-5 rounded-lg transition-all duration-200 hover:scale-105 text-sm shadow-md"
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
        Powered by <strong>Google Gemini Vision OCR</strong> &amp; <strong>ElevenLabs AI Voice Studio</strong>.
      </p>
    </div>
  );
}
