import numpy as np
import math
import logging
from typing import List, Dict, Any, Tuple, Optional
from shapely.geometry import Point, box
from shapely.affinity import rotate, translate

logger = logging.getLogger(__name__)

class AGVController:
    def __init__(self, config: Dict[str, Any]):
        self.wheel_base = config.get("wheel_base", 800.0)
        self.dt = config.get("dt", 0.1)
        self.max_accel = 1500.0
        self.max_dyaw_rate = 3.0

    def is_pose_safe(self, x: float, y: float, theta: float, obstacles: List[Dict[str, Any]], margin=525, ignore_id: str = None, obstacle_geoms: Dict[str, Any] = None, static_tree=None, static_tree_ids=None) -> Tuple[bool, Optional[str]]:
        """
        檢查特定位姿是否安全。優化：優先使用預計算的幾何緩存。
        """
        # 優化：預先計算膨脹後的 AGV 邊界 (AGV 本身 1000x1000)
        # 這裡直接使用膨脹後的尺寸，避免 buffer()
        half_wall = 525 / 2.0  # 牆體/障礙物避讓半徑
        half_social = margin / 2.0 # 車間避讓半徑

        # 牆體碰撞用的多邊形
        wall_poly = box(x - 500, y - 500, x + 500, y + 500)
        wall_poly = rotate(wall_poly, theta, use_radians=True, origin=(x, y))
        # 使用快速 buffer (或者更好的方式是直接定義更大的 box)
        # 牆體避讓膨脹 25mm (525-500)
        wall_check_poly = wall_poly.buffer(25) 

        # 車間碰撞用的多邊形 (如果 margin > 525)
        social_check_poly = None
        if margin > 525:
            social_check_poly = wall_poly.buffer(margin - 500)
        else:
            social_check_poly = wall_check_poly

        # 空間索引候選過濾：social_check_poly 是最大的檢查框，STRtree 回傳與其
        # 包圍盒重疊的靜態障礙（保守超集）。不在候選內的靜態障礙不可能相交，直接略過。
        # 動態障礙（其他 AGV，id 以 "AGV" 開頭）不在索引中，一律照舊逐一檢查。
        candidate_ids = None
        if static_tree is not None and static_tree_ids is not None:
            candidate_ids = {static_tree_ids[i] for i in static_tree.query(social_check_poly)}

        for ob in obstacles:
            oid = str(ob.get("id", "unknown"))
            if ignore_id and oid == ignore_id:
                continue
            # 靜態障礙且包圍盒不重疊 → 不可能碰撞，略過（動態 AGV 不受此過濾影響）
            if candidate_ids is not None and not oid.startswith("AGV") and oid not in candidate_ids:
                continue

            # 智慧對接放行邏輯 (保持不變)
            if ob['type'] == 'equipment':
                if (ob['x'] - x)**2 + (ob['y'] - y)**2 < 4000000: # 2000**2
                    continue

            # --- 核心優化：優先使用緩存 ---
            ob_geom = None
            if obstacle_geoms and oid in obstacle_geoms:
                ob_geom = obstacle_geoms[oid]
            else:
                # 只有緩存中沒有的 (例如其他 AGV) 才動態生成
                if ob['type'] == 'rectangle':
                    w, h = ob.get('width', 1000), ob.get('height', 1000)
                    ob_geom = box(-w/2, -h/2, w/2, h/2)
                    ob_geom = rotate(ob_geom, ob.get('angle', 0), use_radians=True)
                    ob_geom = translate(ob_geom, ob['x'], ob['y'])
                else:
                    ob_geom = Point(ob['x'], ob['y']).buffer(ob.get('radius', 500))

            is_agv = oid.startswith("AGV")
            check_poly = social_check_poly if is_agv else wall_check_poly

            if check_poly.intersects(ob_geom):
                return False, oid
        return True, None


    def compute_command(self, x, y, theta, v_curr, omega_curr, target_wp, max_speed, obstacles, margin=525, dt=0.1, ignore_id: str = None, status: str = None, force_forward: bool = False, obstacle_geoms: Dict[str, Any] = None, static_tree=None, static_tree_ids=None) -> Tuple[float, float, Optional[str]]:
        """
        計算控制指令，支援前進與倒車。
        """
        dx = target_wp[0] - x
        dy = target_wp[1] - y
        distance = math.sqrt(dx**2 + dy**2)
        target_angle = math.atan2(dy, dx)
        
        # 計算相對於車頭的夾角
        alpha = math.atan2(math.sin(target_angle - theta), math.cos(target_angle - theta))

        # 決定行駛方向：如果角度偏差 > 90度 (PI/2)，且沒有強制前進，則使用倒車
        direction = 1.0
        if not force_forward and abs(alpha) > math.pi / 2:
            direction = -1.0
            # 重新計算倒車夾角 (將目標轉向車尾)
            alpha = math.atan2(math.sin(target_angle - (theta + math.pi)), math.cos(target_angle - (theta + math.pi)))

        # 外擺補償 (僅在前進時使用)
        if direction > 0 and abs(alpha) > 0.1:
            swing_dir = theta - (math.pi/2 if alpha > 0 else -math.pi/2)
            swing_offset = min(150.0, 300.0 * math.sin(abs(alpha)))
            comp_target_x = target_wp[0] + math.cos(swing_dir) * swing_offset
            comp_target_y = target_wp[1] + math.sin(swing_dir) * swing_offset
            dx, dy = comp_target_x - x, comp_target_y - y
            distance = math.sqrt(dx**2 + dy**2)
            target_angle = math.atan2(dy, dx)
            alpha = math.atan2(math.sin(target_angle - theta), math.cos(target_angle - theta))

        rotate_margin = max(502, margin - 20)

        # 1. 處理原地旋轉
        if abs(v_curr) < 50.0:
            if abs(alpha) > 0.4:
                w = 1.2 if alpha > 0 else -1.2
                safe, culprit = self.is_pose_safe(x, y, theta + w * 0.1, obstacles, margin=rotate_margin, ignore_id=ignore_id, obstacle_geoms=obstacle_geoms, static_tree=static_tree, static_tree_ids=static_tree_ids)
                if safe:
                    v, w = self.limit_physics(0.0, w, v_curr, omega_curr, max_speed, dt, status=status)
                    return v, w, None
                return 0.0, 0.0, culprit
        else:
            if abs(alpha) > 0.4:
                w = 1.2 if alpha > 0 else -1.2
                safe, culprit = self.is_pose_safe(x, y, theta + w * 0.1, obstacles, margin=rotate_margin, ignore_id=ignore_id, obstacle_geoms=obstacle_geoms, static_tree=static_tree, static_tree_ids=static_tree_ids)
                if safe:
                    v, w = self.limit_physics(0.0, w, v_curr, omega_curr, max_speed, dt, status=status)
                    return v, w, None
                return 0.0, 0.0, culprit

        # 2. 正常追蹤 (支援方向)
        speed = max_speed * (math.cos(alpha) ** 2) * direction
        if abs(alpha) > 0.2: 
            speed = np.clip(speed, -250.0, 250.0)
        
        # 確保有最小移動速度
        if direction > 0: speed = max(50.0, speed)
        else: speed = min(-50.0, speed)
            
        # 增加預瞄距離 (從 400 增加到 600)，平滑轉向響應，過濾路徑微小抖動
        lookahead = max(distance, 600)
        omega = (2.0 * abs(speed) * math.sin(alpha)) / lookahead
        
        cmd_v, cmd_w = self.limit_physics(speed, omega, v_curr, omega_curr, max_speed, dt, status=status)
        
        # 安全路徑投影檢查
        tx, ty, tt = x, y, theta
        for _ in range(4):
            tx += cmd_v * math.cos(tt) * 0.2
            ty += cmd_v * math.sin(tt) * 0.2
            tt += cmd_w * 0.2
            safe, culprit = self.is_pose_safe(tx, ty, tt, obstacles, margin=margin, ignore_id=ignore_id, obstacle_geoms=obstacle_geoms, static_tree=static_tree, static_tree_ids=static_tree_ids)
            if not safe:
                return 0.0, 0.0, culprit
            
        return cmd_v, cmd_w, None

    def limit_physics(self, v, w, v_curr, w_curr, max_speed, dt, status=None):
        # 核心優化：避讓時提供 3 倍加速度，確保瞬間起步
        accel_limit = self.max_accel
        if status in ["EVADING", "STUCK"]:
            accel_limit *= 3.0
            
        v = np.clip(v, v_curr - accel_limit * dt, v_curr + accel_limit * dt)
        w = np.clip(w, w_curr - self.max_dyaw_rate * dt, w_curr + self.max_dyaw_rate * dt)
        v_l = v - (w * self.wheel_base / 2.0); v_r = v + (w * self.wheel_base / 2.0)
        max_wheel_v = max(abs(v_l), abs(v_r))
        if max_wheel_v > max_speed:
            ratio = max_speed / max_wheel_v
            v *= ratio; w *= ratio
        return v, w
