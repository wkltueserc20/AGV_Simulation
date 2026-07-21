import { useSyncExternalStore } from 'react';

// 極簡 toast：模組級 store，任何檔案 import { toast } 即可呼叫，<Toaster/> 只掛一次。
// ponytail: 取代阻塞式 alert()；破壞性確認仍用 window.confirm。
type ToastType = 'info' | 'error' | 'success';
interface ToastItem { id: number; msg: string; type: ToastType; }

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export function toast(msg: string, type: ToastType = 'info') {
  const id = nextId++;
  items = [...items, { id, msg, type }];
  emit();
  setTimeout(() => { items = items.filter(i => i.id !== id); emit(); }, 3500);
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getSnapshot = () => items;

export function Toaster() {
  const list = useSyncExternalStore(subscribe, getSnapshot);
  return (
    <div className="toaster">
      {list.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`} role="status">{t.msg}</div>
      ))}
    </div>
  );
}
