// Unified Text-to-Speech Helper
// Tries ElevenLabs high-quality AI voice via /api/tts first,
// and seamlessly falls back to browser Web Speech API (SpeechSynthesis).

import axios from 'axios';

let currentAudio: HTMLAudioElement | null = null;
let cachedVoices: SpeechSynthesisVoice[] = [];

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  cachedVoices = window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    cachedVoices = window.speechSynthesis.getVoices();
  };
}

function speakBrowserNative(text: string, options?: { urgent?: boolean }): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

  try {
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    if (options?.urgent) {
      utterance.rate = 1.2;
      utterance.pitch = 1.3;
    } else {
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
    }

    const voices = cachedVoices.length > 0 ? cachedVoices : window.speechSynthesis.getVoices();
    const preferred =
      voices.find(v => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Samantha'))) ||
      voices.find(v => v.lang.startsWith('en')) ||
      voices[0];

    if (preferred) {
      utterance.voice = preferred;
    }

    window.speechSynthesis.speak(utterance);
    console.log('[TTS] Speaking via browser Web Speech API');
  } catch (err) {
    console.warn('[TTS] Web Speech API error:', err);
  }
}

export async function speakText(text: string, options?: { urgent?: boolean }): Promise<void> {
  if (!text) return;

  // Stop any currently playing ElevenLabs audio or browser speech
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }

  try {
    // 1. Try ElevenLabs TTS endpoint with short timeout
    const response = await axios.post(
      '/api/tts',
      { text },
      {
        responseType: 'blob',
        timeout: 3000,
      }
    );

    // If backend returned JSON error blob instead of audio/mpeg
    if (response.data.type === 'application/json') {
      speakBrowserNative(text, options);
      return;
    }

    const audioUrl = URL.createObjectURL(response.data);
    const audio = new Audio(audioUrl);
    currentAudio = audio;
    await audio.play();
    console.log('[TTS] Playing ultra-realistic ElevenLabs audio');
    return;

  } catch (err) {
    console.warn('[TTS] ElevenLabs audio unavailable, using Web Speech API fallback');
    speakBrowserNative(text, options);
  }
}

export function stopSpeech(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

