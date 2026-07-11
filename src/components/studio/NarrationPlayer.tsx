'use client';

import { clientApiRequest } from '@/lib/client-api';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Play, Pause, Loader2, Volume2 } from 'lucide-react';

interface NarrationPlayerProps {
  text: string;
}

export default function NarrationPlayer({ text }: NarrationPlayerProps) {
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0); // 0 ~ 1
  const [duration, setDuration] = useState(0); // seconds
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);

  // Update progress via requestAnimationFrame for smoothness
  const updateProgress = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.duration && isPlaying) {
      setProgress(audio.currentTime / audio.duration);
      animFrameRef.current = requestAnimationFrame(updateProgress);
    }
  }, [isPlaying]);

  useEffect(() => {
    if (isPlaying) {
      animFrameRef.current = requestAnimationFrame(updateProgress);
    }
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isPlaying, updateProgress]);

  // Reset when text changes (new slide)
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setAudioUri(null);
    setIsPlaying(false);
    setProgress(0);
    setDuration(0);
    cancelAnimationFrame(animFrameRef.current);
  }, [text]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  const fetchTTS = async () => {
    if (audioUri) return audioUri;
    setIsLoading(true);
    try {
      const res = await clientApiRequest('/api/ai/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAudioUri(data.audioUri);
      return data.audioUri;
    } catch (err) {
      console.error('[TTS fetch error]', err);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const handlePlayPause = async () => {
    if (isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
      return;
    }

    let uri = audioUri;
    if (!uri) {
      uri = await fetchTTS();
    }
    if (!uri) return;

    if (!audioRef.current) {
      const audio = new Audio(uri);
      audio.addEventListener('ended', () => {
        setIsPlaying(false);
        setProgress(1);
      });
      audio.addEventListener('loadedmetadata', () => {
        setDuration(audio.duration);
      });
      audioRef.current = audio;
    }

    try {
      await audioRef.current.play();
      setIsPlaying(true);
      setProgress(0);
    } catch (err) {
      console.error('[Audio play error]', err);
    }
  };

  // Drag / click on progress bar
  const handleProgressInteraction = useCallback(
    (clientX: number) => {
      const bar = progressRef.current;
      if (!bar || !audioRef.current || !duration) return;

      const rect = bar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      audioRef.current.currentTime = ratio * duration;
      setProgress(ratio);
    },
    [duration]
  );

  const handleProgressMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      handleProgressInteraction(e.clientX);

      const onMove = (ev: MouseEvent) => handleProgressInteraction(ev.clientX);
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [handleProgressInteraction]
  );

  const handleProgressTouchStart = useCallback(
    (e: React.TouchEvent) => {
      handleProgressInteraction(e.touches[0].clientX);

      const onMove = (ev: TouchEvent) => handleProgressInteraction(ev.touches[0].clientX);
      const onEnd = () => {
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);
      };
      document.addEventListener('touchmove', onMove);
      document.addEventListener('touchend', onEnd);
    },
    [handleProgressInteraction]
  );

  // Split text into characters and compute highlight boundary
  const highlightCharIndex = Math.floor(progress * text.length);

  return (
    <div className="space-y-2.5">
      {/* Play button + progress bar row */}
      <div className="flex items-center gap-2.5">
        <button
          onClick={handlePlayPause}
          disabled={isLoading}
          className="liquid-glass-btn shrink-0 w-7 h-7 rounded-full flex items-center justify-center"
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 text-amber-400/80 animate-spin" />
          ) : isPlaying ? (
            <Pause className="h-3 w-3 text-amber-400" />
          ) : (
            <Play className="h-3 w-3 text-amber-400 ml-0.5" />
          )}
        </button>

        {/* Thin progress bar */}
        <div
          ref={progressRef}
          className="liquid-glass-card flex-1 h-[3px] rounded-full cursor-pointer group relative"
          onMouseDown={handleProgressMouseDown}
          onTouchStart={handleProgressTouchStart}
        >
          {/* Filled portion */}
          <div
            className="absolute top-0 left-0 h-full rounded-full transition-[width] duration-100"
            style={{
              width: `${progress * 100}%`,
              background: 'linear-gradient(90deg, rgba(251,191,36,0.4), rgba(251,191,36,0.7))',
            }}
          />
          {/* Drag handle (visible on hover) */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
            style={{
              left: `${progress * 100}%`,
              transform: `translate(-50%, -50%)`,
              background: 'rgba(251,191,36,0.9)',
              boxShadow: '0 0 6px rgba(251,191,36,0.5)',
            }}
          />
        </div>

        {/* Duration display */}
        {duration > 0 && (
          <span className="text-[10px] text-[var(--text-quaternary)] tabular-nums shrink-0">
            {formatTime(duration * progress)} / {formatTime(duration)}
          </span>
        )}
      </div>

      {/* Narration text with progressive highlight */}
      <p className="text-[13px] leading-relaxed max-h-[180px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-[var(--border-subtle)] scrollbar-track-transparent">
        {text.split('').map((char, i) => (
          <span
            key={i}
            className="transition-colors duration-200"
            style={{
              color:
                i < highlightCharIndex
                  ? 'var(--text-primary)'
                  : 'var(--text-tertiary)',
            }}
          >
            {char}
          </span>
        ))}
      </p>
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
