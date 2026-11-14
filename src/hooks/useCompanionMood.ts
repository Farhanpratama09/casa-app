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

const DROWSY_DELAY_MS = 25_000; // Kept type compatibility; direct sleep transition at 35s
const SLEEP_DELAY_MS = 35_000;  // 35 detik tanpa interaksi di Resting Mode -> sleep (30-60s range)
const WAKEUP_BOUNCE_DURATION_MS = 420;

export function useCompanionMood(
  initialMood: CompanionMood = 'awake',
  isActive: boolean = true
): UseCompanionMoodReturn {
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
    if (!isActive) return;

    // Gentle transition into sleep squint after 35s of inactivity in Resting Mode
    sleepTimerRef.current = setTimeout(() => {
      moodRef.current = 'sleep';
      setMood('sleep');
    }, SLEEP_DELAY_MS);
  }, [clearIdleTimers, isActive]);

  const wakeUp = useCallback(() => {
    const prevMood = moodRef.current;

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

    if (isActive) {
      scheduleIdleTimers();
    }
  }, [scheduleIdleTimers, isActive]);

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
    if (isActive) {
      // Newly entered Resting Mode: start crisp & bright, then fall asleep after SLEEP_DELAY_MS
      moodRef.current = 'awake';
      setMood('awake');
      scheduleIdleTimers();
    } else {
      clearIdleTimers();
      moodRef.current = 'awake';
      setMood('awake');
    }
    return () => {
      clearIdleTimers();
      if (bounceTimerRef.current) {
        clearTimeout(bounceTimerRef.current);
      }
    };
  }, [isActive, scheduleIdleTimers, clearIdleTimers]);

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
