import math
import json
import os
import logging
import threading
import time
import numpy as np
from typing import List, Dict, Any, Tuple, Optional
from shapely.geometry import Point, box
from shapely.affinity import rotate, translate

from concurrent.futures import ProcessPoolExecutor
from agv import AGV

logger = logging.getLogger(__name__)

class World:
    def __init__(self, width=50000.0, height=50000.0):
        self.width = width
        self.height = height
        self.obstacles: List[Dict[str, Any]] = []
        self.obstacle_geoms: Dict[str, Any] = {} # 幾何緩存
        self.agvs: Dict[str, AGV] = {}
        self.task_queue: List[Dict[str, Any]] = [] 
        self.task_history: List[Dict[str, Any]] = [] # 新增：已完成任務歷史
        self.path_occupancy: Dict[str, List[Tuple[float, float]]] = {}
        self.social_links: List[Dict[str, Any]] = []
        self.reserved_havens: Dict[str, Tuple[float, float]] = {} 
        self.storage_file = "obstacles.json"
        self.agvs_storage_file = "agvs.json"
        self.map_config_file = "map_config.json"

        # 多進程規劃器
        self.executor = ProcessPoolExecutor(max_workers=4)

        self.grid_res = 200.0
        self.load_map_config()  # 可能依匯入地圖設定覆寫 self.width / self.height
        self.nx = int(self.width // self.grid_res)
        self.ny = int(self.height // self.grid_res)
        
        self.static_costmap = np.zeros((self.nx, self.ny))
        self._map_lock = threading.Lock()
        self._is_updating = False
        self._needs_recompute = False

        self.load_obstacles()
        self.load_agvs()
        self.update_static_costmap()

    def update_obstacle_geoms(self):
        """全面更新幾何緩存"""
        new_geoms = {}
        for ob in self.obstacles:
            oid = str(ob.get("id"))
            if ob['type'] == 'rectangle':
                w, h = ob.get('width', 1000), ob.get('height', 1000)
                geom = box(-w/2, -h/2, w/2, h/2)
                geom = rotate(geom, ob.get('angle', 0), use_radians=True)
                geom = translate(geom, ob['x'], ob['y'])
            else:
                geom = Point(ob['x'], ob['y']).buffer(ob.get('radius', 500))
            new_geoms[oid] = geom
        self.obstacle_geoms = new_geoms

    def save_obstacles(self):
        try:
            with open(self.storage_file, 'w', encoding='utf-8') as f:
                json.dump(self.obstacles, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save obstacles: {e}")

    def load_obstacles(self):
        if os.path.exists(self.storage_file):
            try:
                with open(self.storage_file, 'r', encoding='utf-8') as f:
                    self.obstacles = json.load(f)
                # 確保所有設備都有 has_goods 欄位
                for ob in self.obstacles:
                    if ob.get("type") == "equipment" and "has_goods" not in ob:
                        ob["has_goods"] = False
                self.update_obstacle_geoms()
            except Exception as e:
                logger.error(f"Failed to load obstacles: {e}")
                self.obstacles = []

    def save_map_config(self):
        try:
            with open(self.map_config_file, 'w', encoding='utf-8') as f:
                json.dump({"width": self.width, "height": self.height}, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save map config: {e}")

    def load_map_config(self):
        if os.path.exists(self.map_config_file):
            try:
                with open(self.map_config_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                w = float(data.get("width", self.width))
                h = float(data.get("height", self.height))
                if w > 0 and h > 0:
                    self.width = w
                    self.height = h
            except Exception as e:
                logger.error(f"Failed to load map config: {e}")

    def set_map_size(self, width: float, height: float):
        """依匯入地圖的真實物理尺寸 (mm) 調整世界邊界，並重算 costmap。"""
        try:
            w = float(width)
            h = float(height)
        except (TypeError, ValueError):
            return
        if w <= 0 or h <= 0:
            return
        new_nx = int(w // self.grid_res)
        new_ny = int(h // self.grid_res)
        if new_nx == self.nx and new_ny == self.ny and w == self.width and h == self.height:
            return  # 尺寸未變，避免無謂重算
        self.width = w
        self.height = h
        self.nx = new_nx
        self.ny = new_ny
        self.save_map_config()
        self.update_static_costmap()
        logger.info(f"Map size set to {w:.0f}x{h:.0f}mm (grid {self.nx}x{self.ny}).")

    def save_agvs(self):
        try:
            data = {}
            for aid, a in self.agvs.items():
                data[aid] = a.to_dict()
            with open(self.agvs_storage_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save AGVs: {e}")

    def load_agvs(self):
        if os.path.exists(self.agvs_storage_file):
            try:
                with open(self.agvs_storage_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                for aid, state in data.items():
                    self.agvs[aid] = AGV(aid, state["x"], state["y"], state["theta"], state_dict=state)
            except Exception as e:
                logger.error(f"Failed to load AGVs: {e}")
                self.agvs = {}

    def add_task(self, source_id: str, target_id: str, agv_id: str = None):
        task_id = f"TASK-{int(time.time())}-{source_id}-{target_id}"
        task = {
            "id": task_id,
            "source_id": source_id,
            "target_id": target_id,
            "agv_id": agv_id, # 新增：可選的預指派車輛
            "status": "WAITING",
            "created_at": time.time(),
            "execution_time": 0.0
        }
        self.task_queue.append(task)
        logger.info(f"New mission queued: {task_id}")

    def get_task_queue(self) -> List[Dict[str, Any]]:
        # 即時更新執行中的任務耗時
        for task in self.task_queue:
            if task["status"] == "ASSIGNED" and task.get("agv_id") in self.agvs:
                agv = self.agvs[task["agv_id"]]
                task["execution_time"] = agv.current_travel_time
        return self.task_queue

    def complete_task(self, source_id: str, target_id: str, execution_time: float = 0.0):
        """將任務標記為完成並移至歷史紀錄"""
        target_task = None
        for i, t in enumerate(self.task_queue):
            # 支援單階任務的匹配：source 或 target 可能是 None
            source_match = (t["source_id"] == source_id)
            target_match = (t["target_id"] == target_id)
            if source_match and target_match and t["status"] == "ASSIGNED":
                target_task = self.task_queue.pop(i)
                break
        
        if target_task:
            target_task["status"] = "COMPLETED"
            target_task["completed_at"] = time.time()
            target_task["execution_time"] = execution_time
            self.task_history.insert(0, target_task)
            if len(self.task_history) > 20: self.task_history.pop()
            logger.info(f"Task completed: {target_task['id']}")

    def remove_task(self, task_id: str) -> Optional[str]:
        """從隊列中移除任務，並回傳受影響的 agv_id"""
        affected_agv = None
        for i, t in enumerate(self.task_queue):
            if t["id"] == task_id:
                affected_agv = t.get("agv_id")
                self.task_queue.pop(i)
                logger.info(f"Task removed: {task_id}")
                break
        return affected_agv

    def update_static_costmap(self):
        if self._is_updating:
            self._needs_recompute = True
            return
        self._needs_recompute = False
        current_obs = list(self.obstacles)
        thread = threading.Thread(target=self._compute_costmap_task, args=(current_obs,), daemon=True)
        thread.start()

    def _compute_costmap_task(self, obs_list):
        self._is_updating = True
        try:
            # 建立網格座標矩陣 (shape: nx, ny)
            x_coords = np.arange(self.nx) * self.grid_res
            y_coords = np.arange(self.ny) * self.grid_res
            wx, wy = np.meshgrid(x_coords, y_coords, indexing='ij')

            # 初始化最小距離矩陣為與邊界的最小距離
            min_d = np.minimum(
                np.minimum(wx, self.width - wx),
                np.minimum(wy, self.height - wy)
            )

            # 向量化計算所有障礙物的最小距離
            for ob in obs_list:
                if ob['type'] == 'rectangle':
                    w, h = ob.get('width', 1000), ob.get('height', 1000)
                    x1, y1 = ob['x'] - w/2, ob['y'] - h/2
                    x2, y2 = ob['x'] + w/2, ob['y'] + h/2
                    
                    dx = np.maximum(0, np.maximum(x1 - wx, wx - x2))
                    dy = np.maximum(0, np.maximum(y1 - wy, wy - y2))
                    d_rect = np.sqrt(dx**2 + dy**2)
                    min_d = np.minimum(min_d, d_rect)
                else:
                    ox, oy = ob['x'], ob['y']
                    r = ob.get('radius', 500)
                    d_circle = np.sqrt((wx - ox)**2 + (wy - oy)**2) - r
                    min_d = np.minimum(min_d, d_circle)

            # 根據最小距離設定代價地圖
            new_map = np.zeros((self.nx, self.ny))
            new_map[min_d < 550] = 1000000.0
            
            mask = (min_d >= 550) & (min_d < 2000)
            new_map[mask] = (2000.0 / min_d[mask]) ** 4

            with self._map_lock:
                self.static_costmap = new_map
            logger.info("Costmap computation complete.")
        except Exception as e:
            logger.error(f"Costmap failed: {e}")
        finally:
            self._is_updating = False
            if self._needs_recompute: self.update_static_costmap()

    def add_obstacle(self, ob: Dict[str, Any]):
        if ob.get("type") == "equipment" and "has_goods" not in ob:
            ob["has_goods"] = False
        self.obstacles.append(ob); self.save_obstacles()
        self.update_obstacle_geoms()
        self.update_static_costmap()

    def update_obstacle(self, ob_data: Dict[str, Any]):
        target_id = ob_data.get("old_id") or ob_data.get("id")
        new_id = ob_data.get("new_id")
        for ob in self.obstacles:
            if str(ob.get("id")) == str(target_id):
                if new_id: ob["id"] = new_id
                for k, v in ob_data.items():
                    if k not in ["id", "old_id", "new_id"]: ob[k] = v
                break
        self.save_obstacles()
        self.update_obstacle_geoms()
        self.update_static_costmap()

    def remove_obstacle(self, ob_id: str):
        if not ob_id: return
        self.obstacles = [o for o in self.obstacles if str(o.get("id")) != str(ob_id)]
        self.save_obstacles()
        self.update_obstacle_geoms()
        self.update_static_costmap()

    def clear_obstacles(self):
        self.obstacles = []; self.save_obstacles(); 
        self.update_obstacle_geoms(); self.update_static_costmap()

    def update_path_occupancy(self, agv_id: str, path_points: List[Tuple[float, float]]):
        self.path_occupancy[agv_id] = path_points

    def clear_path_occupancy(self, agv_id: str):
        if agv_id in self.path_occupancy: del self.path_occupancy[agv_id]

    def reserve_haven(self, agv_id: str, pos: Tuple[float, float]):
        self.reserved_havens[agv_id] = pos

    def release_haven(self, agv_id: str):
        if agv_id in self.reserved_havens: del self.reserved_havens[agv_id]

    def get_dynamic_obstacles(self, exclude_agv_id: str = None) -> List[Dict[str, Any]]:
        dyn_obs = []
        for oid, o_agv in self.agvs.items():
            if oid != exclude_agv_id:
                dyn_obs.append({"id": oid, "type": "circle", "x": o_agv.x, "y": o_agv.y, "radius": 850.0})
        return dyn_obs
