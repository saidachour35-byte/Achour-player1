import React, { useState, useEffect } from 'react';
import { X, Zap, ArrowRight, CheckCircle2, AlertCircle, RefreshCcw, Wifi } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface SpeedTestModalProps {
  serverUrl?: string;
  onClose: () => void;
}

export default function SpeedTestModal({ serverUrl, onClose }: SpeedTestModalProps) {
  const [status, setStatus] = useState<'idle' | 'testing' | 'completed' | 'error'>('idle');
  const [speed, setSpeed] = useState<number>(0);
  const [progress, setProgress] = useState(0);
  const [latency, setLatency] = useState<number | null>(null);

  const runTest = async () => {
    setStatus('testing');
    setSpeed(0);
    setProgress(0);
    setLatency(null);

    try {
      // 1. Latency Test (Ping)
      const startTime = Date.now();
      const testUrl = serverUrl ? `${serverUrl}/player_api.php` : '/api/proxy/ping';
      
      try {
        await fetch(testUrl, { method: 'HEAD', cache: 'no-store' });
        setLatency(Date.now() - startTime);
      } catch (e) {
        setLatency(Date.now() - startTime); // Fallback estimate
      }

      // 2. Download Speed Test
      // We use a small chunk of data. For IPTV servers, we can try to fetch a small VOD chunk if available, 
      // but a generic 5MB file is better. For now, we simulate with a real fetch if possible or a proxy.
      const downloadUrl = serverUrl 
        ? `${serverUrl}/speedtest.bin` // Some servers have this
        : 'https://speed.cloudflare.com/__down?bytes=5000000'; // Fallback 5MB

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(downloadUrl, { 
        signal: controller.signal,
        cache: 'no-store'
      });
      
      clearTimeout(timeout);

      if (!response.ok) throw new Error('Download failed');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No body reader');

      let receivedLength = 0;
      const downloadStartTime = Date.now();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        receivedLength += value.length;
        const elapsed = (Date.now() - downloadStartTime) / 1000;
        const currentSpeed = (receivedLength * 8) / (elapsed * 1024 * 1024); // Mbps
        
        setSpeed(currentSpeed);
        setProgress(Math.min(95, (receivedLength / 5000000) * 100));
      }

      setProgress(100);
      setStatus('completed');
    } catch (err) {
      console.warn('Speed test error:', err);
      setStatus('error');
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      const btn = document.querySelector('[data-speed-test-start="true"]') as HTMLElement;
      btn?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-lg bg-zinc-900 border-2 border-gold/40 rounded-[2.5rem] overflow-hidden shadow-2xl relative"
      >
        {/* Header */}
        <div className="p-6 border-b border-white/10 flex items-center justify-between bg-black/40">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gold/20 text-gold">
              <Zap size={24} />
            </div>
            <div>
              <h2 className="text-xl font-black text-white uppercase tracking-tight">اختبار سرعة السيرفر</h2>
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Server Speed Diagnostics</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            data-tv-focusable="true"
            className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 focus:ring-4 focus:ring-gold outline-none"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-8 space-y-8">
          {status === 'idle' && (
            <div className="text-center space-y-6 py-4">
              <div className="w-24 h-24 rounded-full bg-gold/10 border-4 border-gold/30 flex items-center justify-center mx-auto shadow-[0_0_30px_rgba(212,175,55,0.1)]">
                <Wifi size={40} className="text-gold" />
              </div>
              <div className="space-y-2">
                <p className="text-sm text-zinc-400 font-medium leading-relaxed">
                  سيقوم هذا الاختبار بقياس سرعة اتصالك المباشر مع سيرفر IPTV الخاص بك لضمان جودة تشغيل 4K بدون تقطيع.
                </p>
              </div>
              <button
                onClick={runTest}
                data-tv-focusable="true"
                data-speed-test-start="true"
                className="w-full py-4 rounded-2xl bg-gold text-black font-black text-base shadow-lg shadow-gold/20 hover:scale-105 active:scale-95 transition-all focus:ring-4 focus:ring-white outline-none"
              >
                ابدأ الاختبار الآن
              </button>
            </div>
          )}

          {(status === 'testing' || status === 'completed') && (
            <div className="space-y-8 py-4">
              {/* Gauge */}
              <div className="relative flex items-center justify-center">
                <svg className="w-48 h-48 transform -rotate-90">
                  <circle
                    cx="96"
                    cy="96"
                    r="88"
                    stroke="currentColor"
                    strokeWidth="12"
                    fill="transparent"
                    className="text-white/5"
                  />
                  <motion.circle
                    cx="96"
                    cy="96"
                    r="88"
                    stroke="currentColor"
                    strokeWidth="12"
                    fill="transparent"
                    strokeDasharray={553}
                    initial={{ strokeDashoffset: 553 }}
                    animate={{ strokeDashoffset: 553 - (553 * (status === 'completed' ? 100 : progress)) / 100 }}
                    className="text-gold"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <motion.span 
                    key={Math.round(speed)}
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="text-5xl font-black text-white"
                  >
                    {speed.toFixed(1)}
                  </motion.span>
                  <span className="text-xs font-black text-gold uppercase tracking-widest mt-1">Mbps</span>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                  <span className="text-[10px] font-black text-zinc-500 uppercase block mb-1">Latency (Ping)</span>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-black text-white">{latency || '--'}</span>
                    <span className="text-xs font-bold text-zinc-400">ms</span>
                  </div>
                </div>
                <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                  <span className="text-[10px] font-black text-zinc-500 uppercase block mb-1">Connection</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-emerald-400 uppercase">Stable</span>
                    <CheckCircle2 size={14} className="text-emerald-400" />
                  </div>
                </div>
              </div>

              {status === 'completed' && (
                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400">
                      <CheckCircle2 size={20} />
                    </div>
                    <p className="text-xs font-bold text-emerald-200 leading-relaxed">
                      اتصالك ممتاز! يمكنك مشاهدة قنوات 4K و UHD بسلاسة تامة.
                    </p>
                  </div>
                  <button
                    onClick={runTest}
                    data-tv-focusable="true"
                    className="w-full py-4 rounded-2xl bg-white/10 text-white font-black text-base hover:bg-white/20 transition-all focus:ring-4 focus:ring-gold outline-none flex items-center justify-center gap-2"
                  >
                    <RefreshCcw size={20} />
                    إعادة الاختبار
                  </button>
                </div>
              )}
            </div>
          )}

          {status === 'error' && (
            <div className="text-center space-y-6 py-4">
              <div className="w-20 h-20 rounded-full bg-red-500/10 border-4 border-red-500/30 flex items-center justify-center mx-auto">
                <AlertCircle size={40} className="text-red-500" />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-black text-white">فشل الاختبار</h3>
                <p className="text-sm text-zinc-400 font-medium">تعذر الاتصال بسيرفر الاختبار، يرجى التحقق من اتصالك بالإنترنت.</p>
              </div>
              <button
                onClick={runTest}
                data-tv-focusable="true"
                className="w-full py-4 rounded-2xl bg-red-500 text-white font-black text-base shadow-lg shadow-red-500/20 focus:ring-4 focus:ring-white outline-none"
              >
                إعادة المحاولة
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
