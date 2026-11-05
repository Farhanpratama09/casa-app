import { useState, useEffect, useRef, useCallback } from 'react';

export type CompanionMood = 'awake' | 'idle' | 'drowsy' | 'sleep';

export interface UseCompanionMoodReturn {
  mood: CompanionMood;
  setMood: React.Dispatch<React.SetStateAction<CompanionMood>>;
  isWakeupBounce: boolean;
  onMouseEnter: () => void;
  onMouseMove: () => void;
  onMouseLeave: () => void;
  wakeUp: () => void;
}

const DROWSY_DELAY_MS = 15_000; // 15 detik -> drowsy
const SLEEP_DELAY_MS = 40_000;  // 40 detik -> sleep
const WAKEUP_BOUNCE_DURATION_MS = 480;

export function useCompanionMood(initialMood: CompanionMood = 'idle'): UseCompanionMoodReturn {
  const [mood, setMood] = useState<CompanionMood>(initialMood);
  const moodRef = useRef<CompanionMood>(initialMood);
  const [isWakeupBounce, setIsWakeupBounce] = useState<boolean>(false);

  const drowsyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sleepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearIdleTimers = useCallback(() => {
    if (drowsyTimerRef.current) {
      clearTimeout(drowsyTimerRef.current);
      drowsyTimerRef.current = null;
    }
    if (sleepTimerRef.current) {
      clearTimeout(sleepTimerRef.current);
      sleepTimerRef.current = null;
    }
  }, []);

  const scheduleIdleTimers = useCallback(() => {
    clearIdleTimers();

    drowsyTimerRef.current = setTimeout(() => {
      moodRef.current = 'drowsy';
      setMood('drowsy');
    }, DROWSY_DELAY_MS);

    sleepTimerRef.current = setTimeout(() => {
      moodRef.current = 'sleep';
      setMood('sleep');
    }, SLEEP_DELAY_MS);
  }, [clearIdleTimers]);

  const wakeUp = useCallback(() => {
    const prevMood = moodRef.current;

    // Jika sebelumnya dari status 'sleep' (atau 'drowsy'), picu micro-bounce wakeup spring
    if (prevMood === 'sleep' || prevMood === 'drowsy') {
      setIsWakeupBounce(true);
      if (bounceTimerRef.current) {
        clearTimeout(bounceTimerRef.current);
      }
      bounceTimerRef.current = setTimeout(() => {
        setIsWakeupBounce(false);
        bounceTimerRef.current = null;
      }, WAKEUP_BOUNCE_DURATION_MS);
    }

    if (prevMood !== 'awake') {
      moodRef.current = 'awake';
      setMood('awake');
    }

    // Reset timer kantuk setiap ada aktivitas kursor
    scheduleIdleTimers();
  }, [scheduleIdleTimers]);

  const onMouseEnter = useCallback(() => {
    wakeUp();
  }, [wakeUp]);

  const onMouseMove = useCallback(() => {
    wakeUp();
  }, [wakeUp]);

  const onMouseLeave = useCallback(() => {
    scheduleIdleTimers();
  }, [scheduleIdleTimers]);

  useEffect(() => {
    scheduleIdleTimers();
    return () => {
      clearIdleTimers();
      if (bounceTimerRef.current) {
        clearTimeout(bounceTimerRef.current);
      }
    };
  }, [scheduleIdleTimers, clearIdleTimers]);

  return {
    mood,
    setMood,
    isWakeupBounce,
    onMouseEnter,
    onMouseMove,
    onMouseLeave,
    wakeUp,
  };
}
