// 自動分配演算法：
// 1. 盡量令每位老師的「值勤總時數」相等（已被固定指派的時段亦計入總時數）
// 2. 在不影響第 1 點的前提下，盡量避免同一位老師連續兩個時段都要值勤
//    （即每節之間盡量有一節休息時間，包括與固定指派的時段之間）
// 3. 在不影響第 1、2 點的前提下，盡量令每位老師同時有高年班及低年班的值勤，
//    避免全部都是高年班或全部都是低年班
// 特殊規則：
// - 有 chainFromLabel 的時段（小息）：由來源時段的同職務老師自動承擔，不重新分配
// - 有 hardExclPrevTeachers 的時段（放學當值）：上一時段的老師絕對不能被分配

const HIGH_GRADE = new Set(['4A', '4B', '4C', '4D', '5A', '5B', '5C', '6A', '6B', '6C']);
const LOW_GRADE  = new Set(['1A', '1B', '2A', '2B', '3A', '3B']);

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

function durationMinutes(startTime, endTime) {
  const d = toMinutes(endTime) - toMinutes(startTime);
  return d > 0 ? d : 0;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * @param {Array<{id:number,name:string}>} teachers - active teachers
 * @param {Array<{
 *   id:number, label:string, start_time:string, end_time:string,
 *   chainFromLabel?:string,
 *   hardExclPrevTeachers?:boolean,
 *   duties: Array<{id:number, name:string, needed_count:number, lockedSeats?:Map<number,number>}>,
 *   unavailable: Set<number>
 * }>} timeSlots - 必須按時間順序排列
 * @returns {Array<{duty_id:number, slot_index:number, teacher_id:number|null}>}
 */
function generateAssignments(teachers, timeSlots) {
  const load = new Map(teachers.map((t) => [t.id, 0]));
  const gradeCounts = new Map(teachers.map((t) => [t.id, { high: 0, low: 0 }]));
  const results = [];

  // 記錄各時段 slot_index=0 的「職務名稱 → 老師 ID」，供 chainFromLabel 查用
  const assignedByLabel = new Map();

  function recordAssignment(slotLabel, dutyName, teacherId, slotIndex) {
    if (slotIndex !== 0) return;
    if (!assignedByLabel.has(slotLabel)) assignedByLabel.set(slotLabel, new Map());
    assignedByLabel.get(slotLabel).set(dutyName, teacherId);
  }

  function updateGrade(teacherId, dutyName, duration) {
    if (load.has(teacherId)) load.set(teacherId, load.get(teacherId) + duration);
    const gc = gradeCounts.get(teacherId);
    if (gc) {
      if (HIGH_GRADE.has(dutyName)) gc.high++;
      else if (LOW_GRADE.has(dutyName)) gc.low++;
    }
  }

  // 預先計算每個時段的固定指派老師集合（用於 nextLockedBusy 前瞻）
  const lockedBusyBySlot = timeSlots.map((slot) => {
    const busy = new Set();
    for (const duty of slot.duties) {
      if (!duty.lockedSeats) continue;
      for (const teacherId of duty.lockedSeats.values()) {
        if (teacherId != null) busy.add(teacherId);
      }
    }
    return busy;
  });

  let prevSlotTeachers = new Set();

  for (let i = 0; i < timeSlots.length; i++) {
    const slot = timeSlots[i];
    const duration = durationMinutes(slot.start_time, slot.end_time);

    // ── 鏈結時段（小息）：由來源時段的老師直接承擔 ──
    if (slot.chainFromLabel) {
      const sourceMap = assignedByLabel.get(slot.chainFromLabel) || new Map();
      const busyInSlot = new Set();

      for (const duty of slot.duties) {
        const teacherId = sourceMap.get(duty.name) ?? null;
        results.push({ duty_id: duty.id, slot_index: 0, teacher_id: teacherId });
        if (teacherId != null) {
          busyInSlot.add(teacherId);
          updateGrade(teacherId, duty.name, duration);
          recordAssignment(slot.label, duty.name, teacherId, 0);
        }
      }
      prevSlotTeachers = busyInSlot;
      continue;
    }

    // ── 一般時段：正常分配 ──

    // 處理固定指派（locked seats）：計入負載、年段、鏈結記錄
    const busyInSlot = new Set();
    if (!assignedByLabel.has(slot.label)) assignedByLabel.set(slot.label, new Map());

    for (const duty of slot.duties) {
      if (!duty.lockedSeats) continue;
      for (const [slotIdx, teacherId] of duty.lockedSeats.entries()) {
        if (teacherId == null) continue;
        busyInSlot.add(teacherId);
        updateGrade(teacherId, duty.name, duration);
        recordAssignment(slot.label, duty.name, teacherId, slotIdx);
      }
    }

    // 收集需要填滿的座位（不含固定指派），隨機排序
    const seats = [];
    for (const duty of slot.duties) {
      for (let s = 0; s < duty.needed_count; s++) {
        if (duty.lockedSeats && duty.lockedSeats.has(s)) continue;
        seats.push({ duty_id: duty.id, slot_index: s, duty_name: duty.name });
      }
    }
    shuffle(seats);

    // 前瞻：盡量避免與下一節固定指派的老師相同（讓對方有一節休息）
    const nextLockedBusy = lockedBusyBySlot[i + 1] || new Set();
    const avoidForRest = new Set([...prevSlotTeachers, ...nextLockedBusy]);

    for (const seat of seats) {
      // 硬性限制（放學當值）：上一時段老師絕對不能被分配
      let pool;
      if (slot.hardExclPrevTeachers) {
        pool = teachers.filter((t) => !busyInSlot.has(t.id) && !slot.unavailable.has(t.id) && !prevSlotTeachers.has(t.id));
        if (pool.length === 0) pool = teachers.filter((t) => !busyInSlot.has(t.id) && !prevSlotTeachers.has(t.id));
        // 最後手段：忽略 unavailable，但仍排除上一節
        if (pool.length === 0) pool = teachers.filter((t) => !prevSlotTeachers.has(t.id));
      } else {
        pool = teachers.filter((t) => !busyInSlot.has(t.id) && !slot.unavailable.has(t.id));
        if (pool.length === 0) pool = teachers.filter((t) => !busyInSlot.has(t.id));
        if (pool.length === 0) pool = teachers;
      }

      if (pool.length === 0) {
        results.push({ duty_id: seat.duty_id, slot_index: seat.slot_index, teacher_id: null });
        continue;
      }

      // 第二優先：盡量有一節休息
      const restedPool = pool.filter((t) => !avoidForRest.has(t.id));
      const primaryPool = restedPool.length > 0 ? restedPool : pool;

      // 第一優先：總時數最少
      const minLoad = Math.min(...primaryPool.map((t) => load.get(t.id)));
      const candidates = primaryPool.filter((t) => load.get(t.id) === minLoad);

      // 第三優先：高低年班混合
      const isHigh = HIGH_GRADE.has(seat.duty_name);
      const isLow  = LOW_GRADE.has(seat.duty_name);
      let finalCandidates = candidates;
      if (isHigh || isLow) {
        const mixed = candidates.filter((t) => {
          const gc = gradeCounts.get(t.id);
          return isHigh ? gc.low > 0 : gc.high > 0;
        });
        if (mixed.length > 0) finalCandidates = mixed;
      }

      const chosen = finalCandidates[Math.floor(Math.random() * finalCandidates.length)];

      updateGrade(chosen.id, seat.duty_name, duration);
      busyInSlot.add(chosen.id);
      recordAssignment(slot.label, seat.duty_name, chosen.id, seat.slot_index);

      results.push({ duty_id: seat.duty_id, slot_index: seat.slot_index, teacher_id: chosen.id });
    }

    prevSlotTeachers = busyInSlot;
  }

  return results;
}

module.exports = { generateAssignments, durationMinutes, toMinutes };
