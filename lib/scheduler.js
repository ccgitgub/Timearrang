// 自動分配演算法：
// 1. 盡量令每位老師的「值勤總時數」相等
// 2. 在不影響第 1 點的前提下，盡量避免同一位老師連續兩個時段都要值勤
//    （即每節之間盡量有一節休息時間）
// duration in minutes, computed from HH:MM strings
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
 * @param {Array<{id:number,name:string}>} teachers - active teachers only
 * @param {Array<{id:number, start_time:string, end_time:string,
 *   duties: Array<{id:number, needed_count:number}>,
 *   unavailable: Set<number>}>} timeSlots - 必須按時間順序排列
 * @returns {Array<{duty_id:number, slot_index:number, teacher_id:number|null}>}
 */
function generateAssignments(teachers, timeSlots) {
  const load = new Map(teachers.map((t) => [t.id, 0]));
  const results = [];

  // 上一個時段被分配到值勤的老師（用於避免連續兩節值勤）
  let prevSlotTeachers = new Set();

  for (const slot of timeSlots) {
    const duration = durationMinutes(slot.start_time, slot.end_time);

    // 收集此時段需要填滿的座位，隨機排序，令重複按「重新分配」時有不同結果
    const seats = [];
    for (const duty of slot.duties) {
      for (let i = 0; i < duty.needed_count; i++) {
        seats.push({ duty_id: duty.id, slot_index: i });
      }
    }
    shuffle(seats);

    const busyInSlot = new Set();

    for (const seat of seats) {
      let pool = teachers.filter((t) => !busyInSlot.has(t.id) && !slot.unavailable.has(t.id));
      if (pool.length === 0) pool = teachers.filter((t) => !busyInSlot.has(t.id));
      if (pool.length === 0) pool = teachers;

      if (pool.length === 0) {
        results.push({ duty_id: seat.duty_id, slot_index: seat.slot_index, teacher_id: null });
        continue;
      }

      // 優先選擇上一節沒有值勤的老師（即可以有一節休息），除非全部候選人上一節都有值勤
      const restedPool = pool.filter((t) => !prevSlotTeachers.has(t.id));
      const primaryPool = restedPool.length > 0 ? restedPool : pool;

      const minLoad = Math.min(...primaryPool.map((t) => load.get(t.id)));
      const candidates = primaryPool.filter((t) => load.get(t.id) === minLoad);
      const chosen = candidates[Math.floor(Math.random() * candidates.length)];

      load.set(chosen.id, load.get(chosen.id) + duration);
      busyInSlot.add(chosen.id);

      results.push({ duty_id: seat.duty_id, slot_index: seat.slot_index, teacher_id: chosen.id });
    }

    prevSlotTeachers = busyInSlot;
  }

  return results;
}

module.exports = { generateAssignments, durationMinutes, toMinutes };
