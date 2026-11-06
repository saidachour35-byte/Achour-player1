import React, { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { ROYAL_THEMES } from '../utils/themeManager';
import logoImg from '../assets/logo.jpg';
import { preloadAllIPTVContent } from '../utils/xtreamPreloader';

export type SplashStyle = 
  | 'floating_3d' 
  | 'cinema_pulse' 
  | 'neon_orbit' 
  | 'minimal_zoom' 
  | 'modern_cinematic' 
  | 'tv_gold_crown' 
  | 'minimal_neon';

interface SplashScreenProps {
  onComplete: () => void;
  royalThemeId?: string;
  soundTrack?: 'cinematic_netflix' | 'royal_brass' | 'soft_chime' | 'sub_bass_woosh' | 'mute';
  splashStyle?: SplashStyle;
  activePlaylist?: any;
  userId?: string;
  language?: string;
}

const TOTAL_SPLASH_DURATION_MS = 15000; // 15 seconds full preload

export default function SplashScreen({ 
  onComplete, 
  royalThemeId = 'royal-gold',
  soundTrack = 'cinematic_netflix',
  activePlaylist,
  userId = 'default',
  language = 'en'
}: SplashScreenProps) {
  const [soundPlayed, setSoundPlayed] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(15);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const isFinishedRef = useRef(false);
  const theme = ROYAL_THEMES.find(t => t.id === royalThemeId) || ROYAL_THEMES[0];

  const playIntroAudio = () => {
    if (soundTrack === 'mute') return;

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = audioCtxRef.current || new AudioContextClass();
      audioCtxRef.current = ctx;

      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const now = ctx.currentTime;

      if (soundTrack === 'cinematic_netflix') {
        // Deep modern cinematic "Ta-Dum" boom: rich low octave hit
        const subOsc1 = ctx.createOscillator();
        const subGain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        subOsc1.type = 'sine';
        subOsc1.frequency.setValueAtTime(55, now);
        subOsc1.frequency.exponentialRampToValueAtTime(36, now + 1.2);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(320, now);
        filter.frequency.exponentialRampToValueAtTime(80, now + 2.0);

        subGain.gain.setValueAtTime(0.001, now);
        subGain.gain.exponentialRampToValueAtTime(0.42, now + 0.05);
        subGain.gain.exponentialRampToValueAtTime(0.18, now + 0.6);
        subGain.gain.exponentialRampToValueAtTime(0.0001, now + 3.0);

        subOsc1.connect(filter);
        filter.connect(subGain);
        subGain.connect(ctx.destination);
        subOsc1.start(now);
        subOsc1.stop(now + 3.2);

        // 15-Second Warm Golden Ambient Strings & Chords Progression
        const chordProgressions = [
          { time: 0.2, root: 130.81, third: 155.56, fifth: 196.00, dur: 4.0 },  // C minor
          { time: 4.0, root: 103.83, third: 130.81, fifth: 155.56, dur: 4.0 },  // Ab major
          { time: 8.0, root: 116.54, third: 146.83, fifth: 174.61, dur: 3.5 },  // Bb major
          { time: 11.5, root: 130.81, third: 164.81, fifth: 196.00, dur: 3.5 }  // C major (Resolve)
        ];

        chordProgressions.forEach(chord => {
          [chord.root, chord.third, chord.fifth].forEach(freq => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            const padFilter = ctx.createBiquadFilter();

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + chord.time);

            padFilter.type = 'lowpass';
            padFilter.frequency.setValueAtTime(600, now + chord.time);

            gain.gain.setValueAtTime(0.0001, now + chord.time);
            gain.gain.exponentialRampToValueAtTime(0.045, now + chord.time + 0.8);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + chord.time + chord.dur);

            osc.connect(padFilter);
            padFilter.connect(gain);
            gain.connect(ctx.destination);

            osc.start(now + chord.time);
            osc.stop(now + chord.time + chord.dur + 0.1);
          });
        });

      } else if (soundTrack === 'soft_chime') {
        const notes = [523.25, 659.25, 783.99, 1046.50, 880.00, 659.25];
        for (let loop = 0; loop < 5; loop++) {
          notes.forEach((freq, i) => {
            const tStart = now + (loop * 3.0) + (i * 0.45);
            if (tStart > now + 14.5) return;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, tStart);
            gain.gain.setValueAtTime(0.001, tStart);
            gain.gain.exponentialRampToValueAtTime(0.06, tStart + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.0001, tStart + 1.8);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(tStart);
            osc.stop(tStart + 2.0);
          });
        }

      } else if (soundTrack === 'sub_bass_woosh') {
        for (let i = 0; i < 4; i++) {
          const tStart = now + i * 3.8;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(60, tStart);
          osc.frequency.exponentialRampToValueAtTime(140, tStart + 0.4);
          osc.frequency.exponentialRampToValueAtTime(40, tStart + 2.2);
          gain.gain.setValueAtTime(0.001, tStart);
          gain.gain.exponentialRampToValueAtTime(0.18, tStart + 0.4);
          gain.gain.exponentialRampToValueAtTime(0.0001, tStart + 2.8);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(tStart);
          osc.stop(tStart + 3.0);
        }
      } else {
        [0, 5, 10].forEach(timeOffset => {
          [196.00, 246.94, 293.66, 392.00].forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sawtooth';
            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(450, now + timeOffset + idx * 0.08);

            const tStart = now + timeOffset + idx * 0.08;
            gain.gain.setValueAtTime(0.0001, tStart);
            gain.gain.exponentialRampToValueAtTime(0.04, tStart + 0.6);
            gain.gain.exponentialRampToValueAtTime(0.0001, tStart + 4.5);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);
            osc.start(tStart);
            osc.stop(tStart + 4.8);
          });
        });
      }

      setSoundPlayed(true);
    } catch (e) {
      console.warn('Audio play notice:', e);
    }
  };

  const finishSplash = () => {
    if (isFinishedRef.current) return;
    isFinishedRef.current = true;
    setTimeout(onComplete, 200);
  };

  useEffect(() => {
    playIntroAudio();

    preloadAllIPTVContent(activePlaylist, userId, () => {});

    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const rem = Math.max(0, Math.ceil((TOTAL_SPLASH_DURATION_MS - elapsed) / 1000));
      setSecondsLeft(rem);
      if (elapsed >= TOTAL_SPLASH_DURATION_MS) {
        clearInterval(interval);
        finishSplash();
      }
    }, 100);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 32 || e.key === 'Select') {
        e.preventDefault();
        finishSplash();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearInterval(interval);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activePlaylist, userId]);

  const particles = [
    { id: 1, x: '20%', y: '30%', size: 4, dur: 4.2, delay: 0 },
    { id: 2, x: '75%', y: '25%', size: 6, dur: 5.1, delay: 0.5 },
    { id: 3, x: '82%', y: '68%', size: 3, dur: 3.8, delay: 1.2 },
    { id: 4, x: '18%', y: '72%', size: 5, dur: 4.6, delay: 0.8 },
    { id: 5, x: '50%', y: '15%', size: 4, dur: 3.5, delay: 0.2 },
  ];

  const skipText = language === 'ar' ? 'تخطي' : 'Skip';

  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, filter: 'blur(10px)', scale: 1.04 }}
      transition={{ duration: 0.45, ease: 'easeInOut' }}
      onClick={() => {
        if (!soundPlayed) playIntroAudio();
      }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-[#050505] select-none overflow-hidden p-6 sm:p-10"
      style={{ perspective: 1200 }}
    >
      {/* Dynamic Ambient Studio Lighting Background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <motion.div 
          animate={{
            scale: [1, 1.18, 1],
            opacity: [0.35, 0.55, 0.35]
          }}
          transition={{
            duration: 3.5,
            repeat: Infinity,
            ease: 'easeInOut'
          }}
          className="absolute inset-0 mix-blend-screen"
          style={{ 
            background: `radial-gradient(circle 520px at center, ${theme.primary} 0%, rgba(0,0,0,0.85) 70%, #050505 100%)` 
          }}
        />

        {/* Ambient Subtle Logo Watermark Glow behind */}
        <motion.div 
          animate={{
            scale: [1.08, 1.18, 1.08],
            opacity: [0.08, 0.16, 0.08]
          }}
          transition={{
            duration: 4,
            repeat: Infinity,
            ease: 'easeInOut'
          }}
          className="absolute inset-0 flex items-center justify-center"
        >
          <img 
            src={logoImg}
            onError={(e) => { e.currentTarget.src = './logo.jpg'; }} 
            alt="" 
            className="w-[340px] h-[340px] object-cover rounded-full blur-3xl"
          />
        </motion.div>

        {/* Floating golden sparkle particles */}
        {particles.map(p => (
          <motion.div
            key={p.id}
            animate={{
              y: [-15, 15, -15],
              x: [-10, 10, -10],
              opacity: [0.2, 0.8, 0.2],
              scale: [0.8, 1.2, 0.8]
            }}
            transition={{
              duration: p.dur,
              repeat: Infinity,
              delay: p.delay,
              ease: 'easeInOut'
            }}
            className="absolute rounded-full pointer-events-none bg-gold/50 blur-[1px]"
            style={{
              left: p.x,
              top: p.y,
              width: p.size,
              height: p.size,
              boxShadow: '0 0 10px rgba(212, 175, 55, 0.8)'
            }}
          />
        ))}

        <div className="absolute inset-0 bg-radial-gradient from-transparent via-black/45 to-black/95 pointer-events-none" />
      </div>

      {/* Top Spacer */}
      <div className="w-full h-8" />

      {/* Center Showcase Area: Logo + App Name + Circular Seconds Ring */}
      <div className="relative flex flex-col items-center justify-center z-10 max-w-lg w-full px-6 text-center my-auto">
        
        {/* Animated 3D Logo Card */}
        <div className="relative mb-6 flex flex-col items-center">
          <motion.div
            animate={{
              scale: [0.85, 1.15, 0.85],
              opacity: [0.35, 0.65, 0.35]
            }}
            transition={{
              duration: 3.2,
              repeat: Infinity,
              ease: 'easeInOut'
            }}
            className="absolute -bottom-6 w-36 h-6 bg-gold/20 rounded-full blur-xl pointer-events-none"
          />

          <motion.div
            initial={{ scale: 0.8, opacity: 0, y: 20 }}
            animate={{
              scale: 1,
              opacity: 1,
              y: [-8, 8, -8],
              rotateY: [-8, 8, -8],
              rotateX: [5, -5, 5]
            }}
            transition={{
              scale: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
              opacity: { duration: 0.5 },
              y: { duration: 3.4, repeat: Infinity, ease: 'easeInOut' },
              rotateY: { duration: 4.2, repeat: Infinity, ease: 'easeInOut' },
              rotateX: { duration: 3.8, repeat: Infinity, ease: 'easeInOut' }
            }}
            style={{ transformStyle: 'preserve-3d' }}
            className="relative"
          >
            <motion.div 
              animate={{
                scale: [1, 1.25, 1],
                opacity: [0.5, 0.85, 0.5]
              }}
              transition={{
                duration: 2.8,
                repeat: Infinity,
                ease: 'easeInOut'
              }}
              className="absolute -inset-3 rounded-3xl blur-2xl pointer-events-none"
              style={{ background: `radial-gradient(circle, ${theme.primary} 0%, transparent 70%)` }}
            />

            <div className="relative w-32 h-32 sm:w-40 sm:h-40 rounded-3xl sm:rounded-[2.2rem] p-1.5 bg-gradient-to-br from-gold/90 via-white/20 to-gold/50 shadow-[0_25px_60px_rgba(0,0,0,0.95)] overflow-hidden">
              <div className="w-full h-full rounded-[18px] sm:rounded-[26px] overflow-hidden bg-black flex items-center justify-center relative">
                <img 
                  src={logoImg}
                  onError={(e) => { e.currentTarget.src = './logo.jpg'; }} 
                  alt="Achour Player" 
                  className="w-full h-full object-cover"
                />

                <motion.div 
                  animate={{ x: ['-250%', '300%'] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut', delay: 0.2 }}
                  className="absolute inset-0 w-1/2 h-full bg-gradient-to-r from-transparent via-white/40 to-transparent skew-x-12 pointer-events-none"
                />
              </div>
            </div>
          </motion.div>
        </div>

        {/* Brand Title & Animated Seconds Circle */}
        <motion.div
          initial={{ y: 15, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="text-center flex flex-col items-center gap-3"
        >
          <h1 className="text-3xl sm:text-5xl font-black uppercase tracking-[0.25em] text-white drop-shadow-md">
            ACHOUR <span className="text-gold">PLAYER</span>
          </h1>

          {/* Animated Circle Progress Ring with Seconds Countdown */}
          <div className="relative w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center mt-2">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 48 48">
              <circle
                cx="24"
                cy="24"
                r="20"
                stroke="rgba(255, 255, 255, 0.12)"
                strokeWidth="3.5"
                fill="transparent"
              />
              <motion.circle
                cx="24"
                cy="24"
                r="20"
                stroke="#D4AF37"
                strokeWidth="3.5"
                strokeDasharray="125.6"
                strokeDashoffset={125.6 * (1 - secondsLeft / 15)}
                strokeLinecap="round"
                fill="transparent"
                transition={{ duration: 0.8, ease: "linear" }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-mono font-black text-lg sm:text-xl text-gold drop-shadow-md">{secondsLeft}</span>
              <span className="text-[8px] font-mono text-zinc-400 font-bold uppercase -mt-1">SEC</span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Bottom Bar: Skip Button Only */}
      <div className="relative z-10 w-full flex items-center justify-end">
        <button
          onClick={finishSplash}
          data-tv-focusable="true"
          className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-white/10 hover:bg-gold hover:text-black text-white font-bold text-xs sm:text-sm transition-all border border-white/15 focus:ring-4 focus:ring-gold outline-none shadow-xl backdrop-blur-md"
        >
          <span>{skipText}</span>
          <ArrowRight size={16} className="rtl:rotate-180" />
        </button>
      </div>
    </motion.div>
  );
}
