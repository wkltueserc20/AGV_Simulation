import heapq
import math
import time
from typing import List, Tuple, Dict, Any, Optional

class AStarPlanner:
    def __init__(self, map_size=50000, grid_size=200):
        self.map_size = map_size
        self.grid_size = grid_size
        self.nodes_x = map_size // grid_size
        self.nodes_y = map_size // grid_size

    def get_path(self, start: List[float], goal: List[float], obstacles: List[Dict[str, Any]], static_costmap=None, path_occupancy: Dict[str, List[Tuple[float, float]]] = None) -> Tuple[List[Tuple[float, float]], List[Tuple[int, int]], Optional[str]]:
        # 依傳入 costmap 形狀動態取得網格尺寸，支援匯入地圖後的任意矩形世界邊界
        if static_costmap is not None:
            self.nodes_x, self.nodes_y = static_costmap.shape

        # --- A. 偵測離開邏輯 ---
        start_eq = None
        for ob in obstacles:
            if ob.get('type') == 'equipment':
                dist = math.sqrt((ob['x'] - start[0])**2 + (ob['y'] - start[1])**2)
                if dist < 500:
                    start_eq = ob; break
        
        exit_segment = []
        actual_start = start
        if start_eq and start_eq.get('docking_angle') is not None:
            angle_rad = (start_eq['docking_angle'] * math.pi) / 180.0
            exit_x = start_eq['x'] - math.cos(angle_rad) * 2000.0
            exit_y = start_eq['y'] - math.sin(angle_rad) * 2000.0
            exit_gx = int(round(exit_x / self.grid_size))
            exit_gy = int(round(exit_y / self.grid_size))
            if 0 <= exit_gx < self.nodes_x and 0 <= exit_gy < self.nodes_y:
                exit_segment = [(start[0], start[1]), (exit_x, exit_y)]
                actual_start = [exit_x, exit_y]

        # --- B. 偵測進入邏輯 ---
        target_eq = None
        for ob in obstacles:
            if ob.get('type') == 'equipment':
                dist = math.sqrt((ob['x'] - goal[0])**2 + (ob['y'] - goal[1])**2)
                if dist < 500: 
                    target_eq = ob; break

        final_goal = goal
        docking_tail = []
        if target_eq and target_eq.get('docking_angle') is not None:
            angle_rad = (target_eq['docking_angle'] * math.pi) / 180.0
            gate_x = target_eq['x'] - math.cos(angle_rad) * 2000.0
            gate_y = target_eq['y'] - math.sin(angle_rad) * 2000.0
            pre_x = target_eq['x'] - math.cos(angle_rad) * 3000.0
            pre_y = target_eq['y'] - math.sin(angle_rad) * 3000.0
            runway_x = target_eq['x'] - math.cos(angle_rad) * 4000.0
            runway_y = target_eq['y'] - math.sin(angle_rad) * 4000.0
            
            def _approach_safe(px, py):
                pgx = int(round(px / self.grid_size))
                pgy = int(round(py / self.grid_size))
                if not (0 <= pgx < self.nodes_x and 0 <= pgy < self.nodes_y):
                    return False
                if static_costmap is not None and static_costmap[pgx, pgy] >= 1000000:
                    return False
                return True

            # 從最遠的 runway 依序退縮，找到第一個地圖內且不被封鎖的進場點
            if _approach_safe(runway_x, runway_y):
                goal = [runway_x, runway_y]
                docking_tail = [(pre_x, pre_y), (gate_x, gate_y), (final_goal[0], final_goal[1])]
            elif _approach_safe(pre_x, pre_y):
                goal = [pre_x, pre_y]
                docking_tail = [(gate_x, gate_y), (final_goal[0], final_goal[1])]
            elif _approach_safe(gate_x, gate_y):
                goal = [gate_x, gate_y]
                docking_tail = [(final_goal[0], final_goal[1])]
            else:
                # 全退縮到設備中心，依賴下方 ignore 半徑邏輯穿越封鎖環
                docking_tail = [(final_goal[0], final_goal[1])]
        else:
            docking_tail = []

        # --- C. A* 搜尋核心邏輯 ---
        start_grid = (int(round(actual_start[0] / self.grid_size)), int(round(actual_start[1] / self.grid_size)))
        goal_grid = (int(round(goal[0] / self.grid_size)), int(round(goal[1] / self.grid_size)))
        
        filtered_obstacles = []
        ignored_eq_ids = set()
        for ob in obstacles:
            if ob.get('type') == 'equipment':
                dist_goal = math.sqrt((ob['x'] - final_goal[0])**2 + (ob['y'] - final_goal[1])**2)
                dist_start = math.sqrt((ob['x'] - start[0])**2 + (ob['y'] - start[1])**2)
                if dist_goal < 3000 or dist_start < 2000:
                    ignored_eq_ids.add(ob['id'])
                    continue
            filtered_obstacles.append(ob)

        relevant_dyn_geoms = []
        for ob in filtered_obstacles:
            if ob.get('radius'):
                relevant_dyn_geoms.append((ob['x'], ob['y'], ob['radius']))

        # --- 效能優化：預計算威脅圖 ---
        threat_grids = set()
        if path_occupancy:
            for oid, path in path_occupancy.items():
                for px, py in path[:30:2]: # 稀疏採樣
                    gx, gy = int(px // self.grid_size), int(py // self.grid_size)
                    r_grid = int(1500 // self.grid_size)
                    for dx in range(-r_grid, r_grid + 1):
                        for dy in range(-r_grid, r_grid + 1):
                            threat_grids.add((gx + dx, gy + dy))

        def get_grid_penalty(gx, gy):
            penalty = 0.0
            if static_costmap is not None:
                penalty = static_costmap[max(0, min(gx, self.nodes_x-1)), max(0, min(gy, self.nodes_y-1))]
            if penalty >= 1000000:
                is_ignored = False
                for ob in obstacles:
                    if ob['id'] in ignored_eq_ids:
                        dist_sq = (gx * self.grid_size - ob['x'])**2 + (gy * self.grid_size - ob['y'])**2
                        if dist_sq < (ob.get('radius', 1000) + 600)**2:
                            is_ignored = True; break
                if is_ignored: penalty = 0.0 
            if penalty >= 1000000: return penalty
            
            # 威脅檢查
            if (gx, gy) in threat_grids: penalty += 15000
            
            for dx, dy, dr in relevant_dyn_geoms:
                if (gx * self.grid_size - dx)**2 + (gy * self.grid_size - dy)**2 < (dr + 300)**2:
                    penalty += 10000
            return penalty

        queue = [(0, 0, start_grid)]
        came_from = {start_grid: None}
        cost_so_far = {start_grid: 0}
        visited = []
        iter_count = 0

        while queue:
            iter_count += 1
            if iter_count % 500 == 0: time.sleep(0) # 釋放 GIL
            
            _, _, current = heapq.heappop(queue)
            visited.append(current)
            if current == goal_grid: break
            for dx, dy in [(0,1),(0,-1),(1,0),(-1,0),(1,1),(1,-1),(-1,1),(-1,-1)]:
                neighbor = (current[0] + dx, current[1] + dy)
                if 0 <= neighbor[0] < self.nodes_x and 0 <= neighbor[1] < self.nodes_y:
                    p = get_grid_penalty(neighbor[0], neighbor[1])
                    if p >= 1000000 and neighbor != goal_grid: continue
                    new_cost = cost_so_far[current] + math.sqrt(dx**2 + dy**2) * self.grid_size + p * 100
                    if neighbor not in cost_so_far or new_cost < cost_so_far[neighbor]:
                        cost_so_far[neighbor] = new_cost
                        h_cost = math.sqrt((goal_grid[0]-neighbor[0])**2 + (goal_grid[1]-neighbor[1])**2) * self.grid_size
                        priority = new_cost + h_cost * 1.001
                        heapq.heappush(queue, (priority, h_cost, neighbor))
                        came_from[neighbor] = current

        if goal_grid not in came_from:
            in_bounds_goal = (0 <= goal_grid[0] < self.nodes_x and 0 <= goal_grid[1] < self.nodes_y)
            in_bounds_start = (0 <= start_grid[0] < self.nodes_x and 0 <= start_grid[1] < self.nodes_y)
            if not in_bounds_goal:
                reason = (f"GOAL_OUT_OF_BOUNDS 目標座標超出地圖邊界 "
                          f"goal=({goal[0]:.0f},{goal[1]:.0f}) goal_grid={goal_grid} "
                          f"合法格範圍 x=[0,{self.nodes_x-1}] y=[0,{self.nodes_y-1}] "
                          f"地圖={self.nodes_x*self.grid_size}x{self.nodes_y*self.grid_size}mm")
            elif not in_bounds_start:
                reason = (f"START_OUT_OF_BOUNDS 起點座標超出地圖邊界 "
                          f"start=({actual_start[0]:.0f},{actual_start[1]:.0f}) start_grid={start_grid}")
            else:
                goal_blocked = (static_costmap is not None and
                                static_costmap[goal_grid[0], goal_grid[1]] >= 1000000)
                walkable = 0
                for dx, dy in [(0,1),(0,-1),(1,0),(-1,0),(1,1),(1,-1),(-1,1),(-1,-1)]:
                    nb = (goal_grid[0] + dx, goal_grid[1] + dy)
                    if 0 <= nb[0] < self.nodes_x and 0 <= nb[1] < self.nodes_y:
                        if get_grid_penalty(nb[0], nb[1]) < 1000000:
                            walkable += 1
                if walkable == 0:
                    reason = (f"GOAL_ENCLOSED 終點鄰格全被封鎖(邊界或障礙環)，A*無法進入終點 "
                              f"goal=({goal[0]:.0f},{goal[1]:.0f}) goal_grid={goal_grid} "
                              f"goal_blocked={goal_blocked}")
                else:
                    reason = (f"NO_PATH_FOUND 走廊被封鎖或搜尋耗盡 goal_grid={goal_grid} "
                              f"goal_blocked={goal_blocked} 可走鄰格={walkable} 已探索節點={len(visited)}")
            return [], visited, reason
        astar_path = []
        curr = goal_grid
        while curr is not None:
            if curr == goal_grid: astar_path.append((goal[0], goal[1]))
            else: astar_path.append((curr[0]*self.grid_size + self.grid_size/2, curr[1]*self.grid_size + self.grid_size/2))
            curr = came_from[curr]
        astar_path.reverse()

        full_path = exit_segment + astar_path
        if docking_tail: full_path.extend(docking_tail)
        return full_path, visited, None

    def find_nearest_safe_spot(self, start_pos: Tuple[float, float], static_costmap, threat_paths: List[List[Tuple[float, float]]]) -> Optional[Tuple[float, float]]:
        if static_costmap is None: return None
        self.nodes_x, self.nodes_y = static_costmap.shape
        start_grid = (int(start_pos[0] // self.grid_size), int(start_pos[1] // self.grid_size))
        queue = [start_grid]; visited = {start_grid}
        max_dist_grids = 30000 // self.grid_size 
        threat_grids = set()
        r_grids = 2500 // self.grid_size
        for path in threat_paths:
            for px, py in path:
                tx, ty = int(px // self.grid_size), int(py // self.grid_size)
                for dx in range(-int(r_grids), int(r_grids) + 1):
                    for dy in range(-int(r_grids), int(r_grids) + 1):
                        if dx*dx + dy*dy <= r_grids**2: threat_grids.add((tx + dx, ty + dy))
        
        for stage in ["FULL"]:
            current_queue = list(queue); current_visited = set(visited)
            while current_queue:
                gx, gy = current_queue.pop(0)
                wx, wy = gx * self.grid_size, gy * self.grid_size
                if 0 <= gx < self.nodes_x and 0 <= gy < self.nodes_y:
                    if static_costmap[gx, gy] < 1000000 and (gx, gy) not in threat_grids:
                        is_footprint_safe = True
                        for bx in range(-2, 3):
                            for by in range(-2, 3):
                                ix, iy = gx + bx, gy + by
                                if not (0 <= ix < self.nodes_x and 0 <= iy < self.nodes_y) or static_costmap[ix, iy] >= 1000000:
                                    is_footprint_safe = False; break
                            if not is_footprint_safe: break
                        if is_footprint_safe:
                            if (wx - start_pos[0])**2 + (wy - start_pos[1])**2 > 2000**2: return (wx, wy)
                if abs(gx - start_grid[0]) < max_dist_grids and abs(gy - start_grid[1]) < max_dist_grids:
                    for dx, dy in [(0,1),(0,-1),(1,0),(-1,0)]:
                        nx, ny = gx + dx, gy + dy
                        if (nx, ny) not in current_visited and 0 <= nx < self.nodes_x and 0 <= ny < self.nodes_y:
                            if static_costmap[nx, ny] < 1000000:
                                current_visited.add((nx, ny)); current_queue.append((nx, ny))
        return None
