import React from 'react';
import { X, Bell, Trash2, Calendar, AlertCircle, Info, CheckCircle2, Crown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { NotificationItem } from '../types';

interface NotificationsModalProps {
  notifications: NotificationItem[];
  onClose: () => void;
  onClear: () => void;
  onRead: (id: string) => void;
}

export default function NotificationsModal({ notifications, onClose, onClear, onRead }: NotificationsModalProps) {
  return (
    <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-2xl flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        className="w-full max-w-2xl bg-zinc-950 border-2 border-white/10 rounded-[2.5rem] overflow-hidden shadow-[0_0_100px_rgba(0,0,0,0.8)] relative"
      >
        {/* Background Glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-20 bg-gold/5 blur-[50px] -z-10" />

        {/* Header */}
        <div className="p-7 border-b border-white/10 flex items-center justify-between bg-black/40 backdrop-blur-md">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gold/10 border border-gold/30 flex items-center justify-center text-gold shadow-lg shadow-gold/5">
              <Bell size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-black text-white uppercase tracking-tight">مركز التنبيهات</h2>
              <p className="text-[10px] font-black text-gold uppercase tracking-[0.3em] mt-0.5">Notification Center</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {notifications.length > 0 && (
              <button 
                onClick={onClear}
                data-tv-focusable="true"
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-red-500/10 text-zinc-400 hover:text-red-400 text-xs font-bold transition-all focus:ring-4 focus:ring-red-500 outline-none"
              >
                <Trash2 size={16} />
                <span>مسح الكل</span>
              </button>
            )}
            <button 
              onClick={onClose}
              data-tv-focusable="true"
              className="p-3 rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-all focus:ring-4 focus:ring-gold outline-none"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="max-h-[60vh] overflow-y-auto no-scrollbar p-6">
          <AnimatePresence initial={false}>
            {notifications.length > 0 ? (
              <div className="space-y-4">
                {notifications.map((notif, idx) => (
                  <motion.div
                    key={notif.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    data-tv-focusable="true"
                    onFocus={() => !notif.read && onRead(notif.id)}
                    className={`p-5 rounded-3xl border transition-all flex gap-4 group cursor-pointer relative overflow-hidden focus:outline-none focus:ring-4 focus:ring-gold focus:scale-102 ${
                      notif.read 
                        ? 'bg-white/5 border-white/5 opacity-70 hover:opacity-100' 
                        : 'bg-gold/5 border-gold/30 shadow-lg shadow-gold/5'
                    }`}
                  >
                    {!notif.read && (
                      <div className="absolute top-0 right-0 w-12 h-12 bg-gold/10 blur-[20px]" />
                    )}

                    <div className={`w-12 h-12 rounded-2xl shrink-0 flex items-center justify-center ${
                      notif.type === 'alert' ? 'bg-red-500/20 text-red-400' :
                      notif.type === 'subscription' ? 'bg-amber-500/20 text-gold' :
                      notif.type === 'success' ? 'bg-emerald-500/20 text-emerald-400' :
                      'bg-blue-500/20 text-blue-400'
                    }`}>
                      {notif.type === 'alert' && <AlertCircle size={22} />}
                      {notif.type === 'subscription' && <Crown size={22} />}
                      {notif.type === 'success' && <CheckCircle2 size={22} />}
                      {notif.type === 'info' && <Info size={22} />}
                    </div>

                    <div className="flex-1 min-w-0 py-0.5">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className={`text-base font-black truncate ${notif.read ? 'text-zinc-300' : 'text-white'}`}>
                          {notif.title}
                        </h3>
                        <span className="text-[10px] font-bold text-zinc-500 flex items-center gap-1.5 shrink-0">
                          <Calendar size={12} />
                          {notif.date}
                        </span>
                      </div>
                      <p className="text-sm text-zinc-400 leading-relaxed font-medium line-clamp-2">
                        {notif.message}
                      </p>
                    </div>

                    {!notif.read && (
                      <div className="w-2 h-2 rounded-full bg-gold absolute top-4 left-4 animate-pulse shadow-[0_0_10px_rgba(212,175,55,1)]" />
                    )}
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-zinc-600 gap-4">
                <div className="w-20 h-20 rounded-full bg-zinc-900 border-2 border-zinc-800 flex items-center justify-center">
                  <Bell size={40} className="opacity-20" />
                </div>
                <div className="text-center">
                  <p className="text-lg font-black uppercase tracking-widest text-zinc-500">لا توجد تنبيهات</p>
                  <p className="text-xs font-bold text-zinc-600 mt-1 uppercase">Your inbox is empty</p>
                </div>
              </div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="p-6 bg-black/40 border-t border-white/5 text-center">
          <p className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.2em]">Achour Player Intelligence System • 2026</p>
        </div>
      </motion.div>
    </div>
  );
}
