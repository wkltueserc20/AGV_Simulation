import math
import numpy as np
import threading
import time
import logging
from enum import Enum
from typing import Dict, Any, List, Tuple, Optional
from kinematics import Kinematics
from controller import AGVController
from planner import AStarPlanner

logger = logging.getLogger(__name__)

class AGVStatus(str, Enum):
    IDLE = "IDLE"
    PLANNING = "PLANNING"
    EXECUTING = "EXECUTING"
    EVADING = "EVADING"
    STUCK = "STUCK"
    LOADING = "LOADING"     
    UNLOADING = "UNLOADING" 
    WAITING = "WAITING"
    THINKING = "THINKING"
    YIELDING = "YIELDING"
    BLOCKED = "BLOCKED"
    ERROR = "ERROR"

class AGVMode(str, Enum):
    SIMULATION = "SIMULATION"
    HARDWARE = "HARDWARE"

class AGV:
    def __init__(self, id: str, x: float, y: float, theta: float = 0.0, state_dict: Optional[Dict[str, Any]] = None):
        self.id = id
        self.x = x; self.y = y; self.theta = theta
        self.v = 0.0; self.omega = 0.0
        self.l_rpm = 0.0; self.r_rpm = 0.0
        
        self.target = {"x": x, "y": y}
        self.global_path: List[Tuple[float, float]] = []
        self.visited_nodes: List[Tuple[int, int]] = []
        
        self.status = AGVStatus.IDLE
        self.mode = AGVMode.SIMULATION 
        self.is_running = False 
        self.is_planning = False
        
        self.max_rpm = 3000.0
        self.replan_needed = True
        self.retry_count = 0
        self.culprit_id = None 
        self.wait_start_time = None
        self.stuck_start_time = None 
        self.recovery_nudge_time = 0.0

        self.kinematics = Kinematics(wheel_base=800.0)
        self.controller = AGVController({"dt": 0.1, "wheel_base": 800.0})
        self.planner = AStarPlanner(grid_size=200)
        self._last_compute_time = 0.0
        self.target_v = 0.0
        self.target_omega = 0.0
        self.evasion_target: Optional[Dict[str, float]] = None
        
        self.has_goods = False
        self.current_task: Optional[Dict[str, Any]] = None
        self.task_timer = 0.0
        self._last_closest_idx = 0
        
        # 模擬時間追蹤
        self.current_travel_time = 0.0
        self.last_travel_time = 0.0
        
        # Traffic Control 擴充
        self.original_target: Optional[Dict[str, float]] = None
        self.yielding_to_ids: set[str] = set()
        self.last_yield_check_time = 0.0

        if state_dict:
            self.x = state_dict.get("x", self.x); self.y = state_dict.get("y", self.y)
            self.theta = state_dict.get("theta", self.theta)
            self.target = state_dict.get("target", self.target)
            self.mode = AGVMode(state_dict.get("mode", self.mode))
            self.max_rpm = state_dict.get("max_rpm", self.max_rpm)
            self.has_goods = state_dict.get("has_goods", False)
            self.current_task = state_dict.get("current_task")
            self.status = AGVStatus.IDLE
            self.is_running = False 
            self.target = {"x": self.x, "y": self.y}
            self.replan_needed = False

    def get_priority(self, world=None) -> int:
        if self.status in [AGVStatus.LOADING, AGVStatus.UNLOADING]:
            return 0
        if self.current_task and world:
            source_ob = next((o for o in world.obstacles if o["id"] == self.current_task.get("source_id")), None)
            if source_ob:
                dist_sq = (self.x - source_ob["x"])**2 + (self.y - source_ob["y"])**2
                if dist_sq < 2500**2: return 0 
            return self.current_task.get("priority", 5)
        if self.is_running or self.status in [AGVStatus.EXECUTING, AGVStatus.PLANNING]:
            return 50
        return 100

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id, "x": self.x, "y": self.y, "theta": self.theta,
            "v": self.v, "omega": self.omega, "l_rpm": self.l_rpm, "r_rpm": self.r_rpm,
            "target": self.target, "status": self.status, "mode": self.mode, "has_goods": self.has_goods,
            "is_running": self.is_running, "is_planning": self.is_planning,
            "path": self.global_path, 
            "visited": self.visited_nodes,
            "max_rpm": self.max_rpm, "culprit_id": self.culprit_id,
            "evasion_target": self.evasion_target, "current_task": self.current_task,
            "yielding_to_ids": list(self.yielding_to_ids),
            "current_travel_time": self.current_travel_time,
            "last_travel_time": self.last_travel_time
        }

    def _on_planning_done(self, future):
        try:
            res = future.result()
            path, visited, reason = res
            if path: # 檢查路徑是否非空
                self.global_path = path
                self._last_closest_idx = 0
                self.visited_nodes = visited
                self.retry_count = 0

                # 如果是正在避讓中，保持 YIELDING
                if self.status == AGVStatus.THINKING:
                    self.status = AGVStatus.YIELDING
                elif self.status == AGVStatus.PLANNING:
                    self.status = AGVStatus.EXECUTING

                # 一般狀態流轉
                if self.status in [AGVStatus.PLANNING, AGVStatus.EXECUTING, AGVStatus.IDLE]:
                    self.status = AGVStatus.EXECUTING if (self.is_running or self.target != {"x": self.x, "y": self.y}) else AGVStatus.IDLE
                elif self.status in [AGVStatus.YIELDING, AGVStatus.WAITING]:
                    self.is_running = True
            else:
                # 規劃失敗處理 (可能是暫時性阻塞)
                tgt = self.target or {}
                loc = (f"reason={reason} target=({tgt.get('x', 0):.0f},{tgt.get('y', 0):.0f}) "
                       f"pos=({self.x:.0f},{self.y:.0f})")
                if self.status in [AGVStatus.PLANNING, AGVStatus.THINKING]:
                    if self.retry_count < 3:
                        logger.warning(f"AGV {self.id} 路徑規劃失敗. {loc} 進入 BLOCKED (retry {self.retry_count + 1}/3)")
                        self.status = AGVStatus.BLOCKED
                        self.retry_count += 1
                        self.wait_start_time = time.time()
                    else:
                        logger.error(f"AGV {self.id} 路徑規劃失敗(已達最大重試). {loc} 進入 ERROR.")
                        self.status = AGVStatus.ERROR
                        self.retry_count = 0
                else:
                    logger.warning(f"AGV {self.id} 路徑規劃失敗. {loc} 進入 STUCK.")
                    self.status = AGVStatus.STUCK
        except Exception as e:
            logger.error(f"Planning Future Error: {e}")
            self.status = AGVStatus.ERROR
            self.retry_count = 0
        finally:
            self.is_planning = False; self.replan_needed = False

    def _async_replan(self, obstacles, static_costmap, world, yielding_to_ids=None):
        self.is_planning = True
        
        # 準備多進程所需純數據
        path_occ_data = {oid: p for oid, p in world.path_occupancy.items() if oid != self.id}
        
        if yielding_to_ids:
            # 閃避搜尋邏輯
            all_threat_paths = []
            ids_to_check = list(yielding_to_ids)
            for oid in ids_to_check:
                if oid in world.path_occupancy:
                    all_threat_paths.append(world.path_occupancy[oid])
            
            # 如果沒有指定的 ID 或路徑為空，則退回原本的「避開所有非我車輛」邏輯
            if not all_threat_paths:
                all_threat_paths = list(path_occ_data.values())
            
            safe_spot = self.planner.find_nearest_safe_spot((self.x, self.y), static_costmap, all_threat_paths)
            if safe_spot:
                if self.status not in [AGVStatus.YIELDING, AGVStatus.EVADING]:
                    self.original_target = {"x": self.target["x"], "y": self.target["y"]}
                
                self.evasion_target = {"x": safe_spot[0], "y": safe_spot[1]}
                self.target = self.evasion_target
                self.yielding_to_ids.update(yielding_to_ids)
                self.status = AGVStatus.THINKING # 顯式設定為 THINKING
                
                # 提交 A* 到進程池
                future = world.executor.submit(self.planner.get_path, [self.x, self.y], [self.target["x"], self.target["y"]], obstacles, static_costmap, path_occ_data)
                future.add_done_callback(self._on_planning_done)
            else:
                self.status = AGVStatus.STUCK; self.is_planning = False
        else:
            # 一般路徑搜尋
            if self.status not in [AGVStatus.YIELDING, AGVStatus.WAITING, AGVStatus.LOADING, AGVStatus.UNLOADING]:
                self.status = AGVStatus.PLANNING
            future = world.executor.submit(self.planner.get_path, [self.x, self.y], [self.target["x"], self.target["y"]], obstacles, static_costmap, path_occ_data)
            future.add_done_callback(self._on_planning_done)

    def update(self, dt: float, world):
        if self.is_running:
            self.current_travel_time += dt

        if self.status in [AGVStatus.LOADING, AGVStatus.UNLOADING, AGVStatus.WAITING, AGVStatus.THINKING, AGVStatus.STUCK, AGVStatus.BLOCKED, AGVStatus.ERROR]:
            self.v = 0; self.omega = 0; self.target_v = 0; self.target_omega = 0
            self.l_rpm, self.r_rpm = 0, 0
            
            if self.status in [AGVStatus.WAITING, AGVStatus.STUCK]:
                if not self.current_task:
                    self.status = AGVStatus.IDLE; self.is_running = False; self.yielding_to_ids = set(); self.original_target = None; return
            
            if self.status == AGVStatus.BLOCKED:
                if self.wait_start_time and (time.time() - self.wait_start_time > 2.0):
                    self.replan_needed = True
                    # 立即觸發規劃，不要等下一幀的物理迴圈
                    all_obs = world.obstacles + world.get_dynamic_obstacles(exclude_agv_id=self.id)
                    self._async_replan(all_obs, world.static_costmap, world)
                    return

            if self.status == AGVStatus.WAITING:
                if self.yielding_to_ids:
                    current_time = time.time()
                    if current_time - self.last_yield_check_time >= 10.0:
                        self.last_yield_check_time = current_time
                        still_yielding_ids = set()
                        for oid in list(self.yielding_to_ids):
                            other_path = world.path_occupancy.get(oid, [])
                            if not other_path: continue
                            is_still_conflict = False
                            for ox, oy in other_path[:100]:
                                if (ox - self.x)**2 + (oy - self.y)**2 < 6250000: is_still_conflict = True; break
                            if is_still_conflict: still_yielding_ids.add(oid)
                        self.yielding_to_ids = still_yielding_ids
                
                if not self.yielding_to_ids and self.original_target:
                    if self.wait_start_time and (time.time() - self.wait_start_time > 2.0):
                        logger.info(f"AGV {self.id} recovery triggered. Resuming {self.original_target}")
                        self.target = self.original_target
                        self.original_target = None
                        self.is_running = True
                        self.status = AGVStatus.PLANNING
                        # 立即啟動規劃，不要等下一幀
                        all_obs = world.obstacles + world.get_dynamic_obstacles(exclude_agv_id=self.id)
                        self._async_replan(all_obs, world.static_costmap, world)
                        return 

            if self.status in [AGVStatus.LOADING, AGVStatus.UNLOADING]:
                self.task_timer -= dt
                if self.task_timer <= 0:
                    if self.status == AGVStatus.LOADING:
                        self.has_goods = True
                        if self.current_task:
                            source = next((o for o in world.obstacles if o["id"] == self.current_task["source_id"]), None)
                            if source: source["has_goods"] = False; world.save_obstacles()
                            tid = self.current_task.get("target_id")
                            if tid:
                                target_ob = next((o for o in world.obstacles if o["id"] == tid), None)
                                if target_ob: self.target = {"x": target_ob["x"], "y": target_ob["y"]}; self.status = AGVStatus.EXECUTING; self.is_running = True; self.replan_needed = True
                                else: 
                                    world.complete_task(self.current_task["source_id"], None, execution_time=self.current_travel_time)
                                    self.last_travel_time = self.current_travel_time; self.current_travel_time = 0.0
                                    self.status = AGVStatus.IDLE; self.is_running = False; self.current_task = None
                            else: 
                                world.complete_task(self.current_task["source_id"], None, execution_time=self.current_travel_time)
                                self.last_travel_time = self.current_travel_time; self.current_travel_time = 0.0
                                self.status = AGVStatus.IDLE; self.is_running = False; self.current_task = None
                    else:
                        self.has_goods = False
                        if self.current_task:
                            target_ob = next((o for o in world.obstacles if o["id"] == self.current_task["target_id"]), None)
                            if target_ob: target_ob["has_goods"] = True; world.save_obstacles()
                            world.complete_task(self.current_task.get("source_id"), self.current_task["target_id"], execution_time=self.current_travel_time)
                        self.last_travel_time = self.current_travel_time; self.current_travel_time = 0.0
                        self.status = AGVStatus.IDLE; self.is_running = False; self.current_task = None
            return

        if self.replan_needed and self.is_running and not self.is_planning:
            all_obs = world.obstacles + world.get_dynamic_obstacles(exclude_agv_id=self.id)
            self._async_replan(all_obs, world.static_costmap, world)

        self._last_compute_time += dt
        if self._last_compute_time >= 0.05:
            self.check_proactive_evasion(world)

        closest_idx = self._last_closest_idx
        if self.global_path:
            min_dist = float("inf")
            search_end = min(len(self.global_path), self._last_closest_idx + 20)
            for i in range(self._last_closest_idx, search_end):
                d = (self.global_path[i][0] - self.x)**2 + (self.global_path[i][1] - self.y)**2
                if d < min_dist: min_dist = d; closest_idx = i
            self._last_closest_idx = closest_idx

        if self.global_path and self.is_running: world.update_path_occupancy(self.id, self.global_path[closest_idx :])
        else: world.clear_path_occupancy(self.id)

        if not self.is_running or not self.global_path: self.v = 0; self.omega = 0; self.l_rpm, self.r_rpm = 0, 0; return

        if self._last_compute_time >= 0.05:
            self._last_compute_time = 0.0
            all_obs = world.obstacles + world.get_dynamic_obstacles(exclude_agv_id=self.id)
            lookahead = max(1, int(4 + abs(self.v) / 100.0))
            target_wp = self.global_path[min(closest_idx + lookahead, len(self.global_path)-1)]
            is_docking = False; target_angle = None; final_wp = self.global_path[-1]
            for ob in world.obstacles:
                if ob.get('type') == 'equipment' and ob['x'] == final_wp[0] and ob['y'] == final_wp[1]:
                    target_angle = ob.get('docking_angle')
                    if math.sqrt((self.x - final_wp[0])**2 + (self.y - final_wp[1])**2) < 3200: is_docking = True; break
            force_forward = False; goto_ctrl = True; max_speed = self.max_rpm * self.kinematics.rpm_to_mms
            if is_docking and target_angle is not None:
                target_rad = (target_angle * math.pi) / 180.0; err = math.atan2(math.sin(target_rad - self.theta), math.cos(target_rad - self.theta))
                dist = math.sqrt((self.x - final_wp[0])**2 + (self.y - final_wp[1])**2)
                if dist < 4000: max_speed = min(max_speed, 200.0 if abs(err) > 0.1 else 400.0)
                if 1950 < dist < 2100:
                    if abs(err) > 0.04:
                        if abs(self.v) > 20: self.target_v = 0; self.target_omega = 0
                        else: self.target_v = 0; self.target_omega = np.clip(err * 2.5, -1.2, 1.2)
                        goto_ctrl = False
                    else: force_forward = True
                elif dist <= 1950: force_forward = True
            if goto_ctrl:
                ignore_id = None # Simplified for MVP
                bv, bo, culprit = self.controller.compute_command(self.x, self.y, self.theta, self.v, self.omega, target_wp, max_speed, all_obs, dt=0.05, force_forward=force_forward, ignore_id=ignore_id, obstacle_geoms=world.obstacle_geoms)
                self.target_v, self.target_omega = bv, bo; self.culprit_id = culprit

        self.v, self.omega = self.controller.limit_physics(self.target_v, self.target_omega, self.v, self.omega, self.max_rpm * self.kinematics.rpm_to_mms, dt)
        new_x, new_y, new_theta = self.kinematics.update_pose(self.x, self.y, self.theta, self.v, self.omega, dt)
        all_obs = world.obstacles + world.get_dynamic_obstacles(exclude_agv_id=self.id)
        margin = 505 if self.status == AGVStatus.EVADING else 525
        safe, _ = self.controller.is_pose_safe(new_x, new_y, new_theta, all_obs, margin=margin, obstacle_geoms=world.obstacle_geoms)
        if safe: self.x, self.y, self.theta = new_x, new_y, new_theta
        else: self.v = 0; self.omega = 0; self.target_v = 0; self.target_omega = 0

        dist_final = math.sqrt((self.x - self.target["x"])**2 + (self.y - self.target["y"])**2)
        if dist_final < 300:
            if self.status in [AGVStatus.YIELDING, AGVStatus.EVADING]:
                self.status = AGVStatus.WAITING; self.wait_start_time = time.time(); self.v = 0; self.omega = 0
            elif self.current_task and self.status not in [AGVStatus.WAITING, AGVStatus.THINKING]:
                # 獲取任務工位的精確座標
                source_ob = next((o for o in world.obstacles if o["id"] == self.current_task.get("source_id")), None)
                target_ob = next((o for o in world.obstacles if o["id"] == self.current_task.get("target_id")), None)
                
                # 改用物理座標 (self.x, self.y) 比對，並將容錯放寬至 500mm
                is_at_source = (math.sqrt((self.x - source_ob["x"])**2 + (self.y - source_ob["y"])**2) < 500) if source_ob else False
                is_at_target = (math.sqrt((self.x - target_ob["x"])**2 + (self.y - target_ob["y"])**2) < 500) if target_ob else False

                if is_at_source and not self.has_goods:
                    self.status = AGVStatus.LOADING; self.task_timer = 5.0
                elif is_at_target and self.has_goods:
                    self.status = AGVStatus.UNLOADING; self.task_timer = 5.0
                else:
                    # 如果真的既不在起點也不在終點 (例如是真的避讓中繼點)，才進入 WAITING
                    if self.status != AGVStatus.IDLE:
                        self.status = AGVStatus.WAITING; self.wait_start_time = time.time()
                
                self.v = 0; self.omega = 0; self.is_running = (self.status != AGVStatus.IDLE)
            elif self.status not in [AGVStatus.WAITING, AGVStatus.YIELDING, AGVStatus.EVADING]:
                if self.current_travel_time > 0: self.last_travel_time = self.current_travel_time; self.current_travel_time = 0.0
                self.is_running = False; self.status = AGVStatus.IDLE; self.v = 0; self.omega = 0
        self.l_rpm, self.r_rpm = self.kinematics.velocity_to_rpm(self.v, self.omega)

    def check_proactive_evasion(self, world) -> bool:
        if self.status in [AGVStatus.EVADING, AGVStatus.YIELDING, AGVStatus.THINKING]: return False
        if self.current_task:
            source_ob = next((o for o in world.obstacles if o["id"] == self.current_task.get("source_id")), None)
            if source_ob:
                dist_to_source = math.sqrt((self.x - source_ob["x"])**2 + (self.y - source_ob["y"])**2)
                if dist_to_source < 2500: return False
        my_prio = self.get_priority(world)
        my_path = self.global_path[self._last_closest_idx : self._last_closest_idx + 100]
        if not my_path: my_path = [(self.x, self.y)]
        conflict_ids = set()
        for other_id, other_agv in world.agvs.items():
            if other_id == self.id: continue
            other_path = world.path_occupancy.get(other_id, [])
            if not other_path: continue
            has_conflict = False
            for mx, my in my_path[::5]:
                for ox, oy in other_path[:100:5]:
                    if (mx - ox)**2 + (my - oy)**2 < 6250000: has_conflict = True; break
                if has_conflict: break
            if not has_conflict: continue
            other_prio = other_agv.get_priority(world)
            should_i_yield = (my_prio > other_prio) or (my_prio == other_prio and self.id > other_id)
            if should_i_yield: conflict_ids.add(other_id)
        if conflict_ids: self.status = AGVStatus.THINKING; self.trigger_evasion(world, conflict_ids); return True
        return False

    def trigger_evasion(self, world, yielding_to_ids=None):
        if self.is_planning: return 
        all_obs = world.obstacles + world.get_dynamic_obstacles(exclude_agv_id=self.id)
        self._async_replan(all_obs, world.static_costmap, world, yielding_to_ids)
