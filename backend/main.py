import asyncio
import json
import logging
import os
import sys
import time
import threading
import queue
import uuid
import math
from contextlib import asynccontextmanager
from typing import List, Dict, Any
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from world import World
from agv import AGV

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 背景執行緒與廣播任務於此啟動（取代 deprecated 的 on_event("startup")）
    threading.Thread(target=physics_engine_thread, daemon=True).start()
    threading.Thread(target=disk_saver_thread, daemon=True).start()
    asyncio.create_task(telemetry_broadcaster())
    yield

app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

SIM_MULTIPLIER = 1
world = World()
world_lock = threading.Lock()
cmd_queue = queue.Queue()

# 初始化一輛 AGV (僅在全新環境下)
with world_lock:
    if not world.agvs:
        init_id = f"AGV-{str(uuid.uuid4())[:4].upper()}"
        world.agvs[init_id] = AGV(init_id, 5000.0, 5000.0)
        world.save_agvs()

def get_snapshot():
    """獲取當前世界的完整快照"""
    with world_lock:
        return {
            "agvs": [a.to_dict() for a in world.agvs.values()],
            "obstacles": list(world.obstacles),
            "multiplier": SIM_MULTIPLIER,
            "path_occupancy": {k: v[::5] for k, v in world.path_occupancy.items()},
            "reserved_havens": {k: v for k, v in world.reserved_havens.items()},
            "task_queue": world.get_task_queue(),
            "task_history": world.task_history,
            "social_links": world.social_links,
            "map_size": {"width": world.width, "height": world.height}
        }

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
    async def connect(self, ws: WebSocket):
        await ws.accept(); self.active_connections.append(ws)
    def disconnect(self, ws: WebSocket):
        if ws in self.active_connections: self.active_connections.remove(ws)
    async def broadcast(self, data: dict):
        msg = json.dumps({"type": "telemetry", "data": data})
        for conn in self.active_connections[:]:
            try: await conn.send_text(msg)
            except: 
                if conn in self.active_connections: self.active_connections.remove(conn)

manager = ConnectionManager()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            raw_data = await websocket.receive_text()
            cmd_queue.put(json.loads(raw_data))
    except WebSocketDisconnect:
        manager.disconnect(websocket)

def process_commands():
    global SIM_MULTIPLIER
    while not cmd_queue.empty():
        msg = cmd_queue.get_nowait()
        t = msg.get("type")
        # 增加容錯：從多個可能的地方讀取 ID
        target_id = msg.get("agv_id") or msg.get("target_id") or msg.get("id")
        
        try:
            with world_lock:
                if t == "set_multiplier":
                    SIM_MULTIPLIER = int(msg.get("data", 1))
                elif t == "add_agv":
                    new_id = f"AGV-{str(uuid.uuid4())[:4].upper()}"
                    world.agvs[new_id] = AGV(new_id, msg.get("x", 5000), msg.get("y", 5000))
                    world.mark_agvs_dirty()
                elif t == "add_obstacle":
                    world.add_obstacle(msg.get("data"))
                elif t == "update_obstacle":
                    world.update_obstacle(msg.get("data"))
                elif t == "clear_obstacles":
                    world.clear_obstacles()
                elif t == "remove_obstacle":
                    ob_id = msg.get("id") or (msg.get("data") if not isinstance(msg.get("data"), dict) else msg.get("data").get("id"))
                    if ob_id: world.remove_obstacle(str(ob_id))
                elif t == "dispatch_task":
                    # 修正：直接從 msg 讀取，並包含可選的 agv_id
                    world.add_task(msg.get("source_id"), msg.get("target_id"), msg.get("agv_id"))
                elif t == "clear_tasks":

                    world.task_queue = []
                    world.task_history = []
                elif t == "remove_task":
                    task_id = msg.get("task_id")
                    affected_agv_id = world.remove_task(task_id)
                    if affected_agv_id and affected_agv_id in world.agvs:
                        a = world.agvs[affected_agv_id]
                        # 如果車輛處於暫停 (is_running=False)，則清空任務
                        if not a.is_running:
                            a.current_task = None; a.status = "IDLE"; a.global_path = []
                elif t == "set_all_speeds":
                    new_speed = float(msg.get("data", 3000))
                    for agv in world.agvs.values():
                        agv.max_rpm = new_speed
                    world.mark_agvs_dirty()
                elif t == "set_map_size":
                    world.set_map_size(msg.get("width"), msg.get("height"))
                elif t == "import_state":
                    world.import_state(msg.get("data", {}))
                elif target_id and target_id in world.agvs:
                    a = world.agvs[target_id]
                    if t == "start": 
                        logger.info(f"Command START received for AGV {target_id}")
                        a.is_running = True; a.replan_needed = True
                    elif t == "pause": 
                        logger.info(f"Command PAUSE received for AGV {target_id}")
                        a.is_running = False
                    elif t == "remove_agv": del world.agvs[target_id]; world.mark_agvs_dirty()
                    elif t == "reset":
                        a.x, a.y, a.theta = 5000.0, 5000.0, 0.0
                        a.v, a.omega = 0.0, 0.0; a.is_running = False; a.global_path = []
                        if a.current_travel_time > 0: a.last_travel_time = a.current_travel_time; a.current_travel_time = 0
                    elif t == "force_idle":
                        # 強制設為 IDLE，清空任務與路徑，但不改變當前位置
                        a.v, a.omega = 0.0, 0.0
                        a.status = "IDLE"; a.is_running = False
                        a.current_task = None; a.global_path = []; a.yielding_to_id = None
                        a.original_target = None; a.replan_needed = False
                        if a.current_travel_time > 0: a.last_travel_time = a.current_travel_time; a.current_travel_time = 0
                    elif t == "set_target":
                        a.target = msg.get("data")
                        a.is_running = True
                        a.replan_needed = True
                        a.status = "PLANNING"
                    elif t == "set_speed": a.max_rpm = float(msg.get("data", 3000))
                
                # 任何變動後觸發重新規劃 (僅針對正在運行的 AGV)
                if t in ["add_obstacle", "update_obstacle", "clear_obstacles", "remove_obstacle", "set_map_size"]:
                    for a in world.agvs.values():
                        if a.is_running:
                            a.replan_needed = True
        except Exception as e:
            logger.error(f"Command Error ({t}): {e}")

def physics_engine_thread():
    real_dt = 0.0166 
    last_dispatch_time = time.time()
    while True:
        cycle_start = time.time()
        process_commands()
        
        # --- 智慧調度員 (Dispatcher) ---
        if cycle_start - last_dispatch_time > 1.0:
            last_dispatch_time = cycle_start
            try:
                with world_lock:
                    pending_tasks = [t for t in world.task_queue if t["status"] == "WAITING"]
                    idle_agvs = [a for a in world.agvs.values() if a.status == "IDLE" and not a.is_running]
                    
                    for task in pending_tasks:
                        if not idle_agvs: break
                        
                        # 調度篩選邏輯
                        is_dropoff_only = (not task.get("source_id"))
                        
                        # 如果任務已經預指定了 AGV (來自前端點擊 AGV 的操作)
                        pre_assigned_id = task.get("agv_id")
                        best_agv = None
                        
                        if pre_assigned_id:
                            # 檢查該指定車輛是否在空閒清單中
                            best_agv = next((a for a in idle_agvs if a.id == pre_assigned_id), None)
                            # 檢查貨物條件
                            if best_agv:
                                eligible = best_agv.has_goods if is_dropoff_only else not best_agv.has_goods
                                if not eligible: best_agv = None # 不符合條件，放棄該任務指派
                        
                        if not best_agv:
                            # 無預指定或預指定不可用，進行一般調度
                            potential_agvs = []
                            if is_dropoff_only:
                                potential_agvs = [a for a in idle_agvs if a.has_goods]
                            else:
                                potential_agvs = [a for a in idle_agvs if not a.has_goods]
                            
                            if not potential_agvs: continue

                            ref_id = task["source_id"] if task.get("source_id") else task["target_id"]
                            ref_ob = next((o for o in world.obstacles if o["id"] == ref_id), None)
                            if not ref_ob: task["status"] = "ERROR"; continue
                            
                            best_agv = min(potential_agvs, key=lambda a: math.sqrt((a.x - ref_ob["x"])**2 + (a.y - ref_ob["y"])**2))
                        
                        # 最終分配
                        if best_agv:
                            task["status"] = "ASSIGNED"
                            task["agv_id"] = best_agv.id
                            best_agv.current_task = {"source_id": task.get("source_id"), "target_id": task.get("target_id")}
                            
                            ref_id = task["source_id"] if task.get("source_id") else task["target_id"]
                            ref_ob = next((o for o in world.obstacles if o["id"] == ref_id), None)
                            best_agv.target = {"x": ref_ob["x"], "y": ref_ob["y"]}
                            best_agv.is_running = True; best_agv.replan_needed = True
                            world.mark_agvs_dirty()
                            idle_agvs.remove(best_agv)
            except Exception as e:
                logger.error(f"Dispatcher Error: {e}")

        sim_dt = real_dt * SIM_MULTIPLIER
        with world_lock:
            for a in world.agvs.values():
                a.update(sim_dt, world)
        
        elapsed = time.time() - cycle_start
        if real_dt > elapsed: time.sleep(real_dt - elapsed)

async def telemetry_broadcaster():
    while True:
        start_time = asyncio.get_event_loop().time()
        data = get_snapshot()
        await manager.broadcast(data)
        elapsed = asyncio.get_event_loop().time() - start_time
        await asyncio.sleep(max(0.01, 0.033 - elapsed))

def disk_saver_thread():
    """鎖外持久化：僅在鎖內快速序列化，實際磁碟寫入於鎖外，避免阻塞物理迴圈。
    AGV 位置持續變動，沿用每 5s 落盤；障礙物僅在 dirty 時寫入。"""
    last_agv_save = time.time()
    while True:
        time.sleep(1.0)
        now = time.time()
        obs_json = None; agv_json = None
        try:
            with world_lock:
                if world._obstacles_dirty:
                    obs_json = json.dumps(world.obstacles, indent=2)
                    world._obstacles_dirty = False
                if world._agvs_dirty or (now - last_agv_save > 5.0):
                    agv_json = json.dumps({aid: a.to_dict() for aid, a in world.agvs.items()}, indent=2)
                    world._agvs_dirty = False
                    last_agv_save = now
            # 磁碟 I/O 於鎖外執行
            if obs_json is not None:
                with open(world.storage_file, 'w', encoding='utf-8') as f: f.write(obs_json)
            if agv_json is not None:
                with open(world.agvs_storage_file, 'w', encoding='utf-8') as f: f.write(agv_json)
        except Exception as e:
            logger.error(f"Disk saver error: {e}")

# 服務打包好的前端（frontend/dist）：一鍵啟動 / 打包 exe 時前後端同源同埠。
# 必須放在所有 API/WebSocket 路由「之後」掛載，"/" 的 StaticFiles 才不會蓋掉 /ws。
# html=True 讓 "/" 回傳 index.html。
# 打包成 exe（frozen）時，dist 被 PyInstaller 解到 sys._MEIPASS/frontend/dist。
if getattr(sys, "frozen", False):
    _DIST = os.path.join(sys._MEIPASS, "frontend", "dist")  # type: ignore[attr-defined]
else:
    _DIST = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")

if os.path.isdir(_DIST):
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="frontend")
else:
    logger.warning("frontend/dist 不存在，僅提供 API；請先在 frontend 執行 npm run build。")

if __name__ == "__main__":
    import uvicorn
    # 打包成 exe 時，啟動後自動開瀏覽器
    if getattr(sys, "frozen", False):
        import threading, webbrowser
        threading.Timer(2.0, lambda: webbrowser.open("http://localhost:8000/")).start()
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="warning")
