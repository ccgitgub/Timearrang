// 自動分配演算法：
// 1. 盡量令每位老師的「值勤總時數」相等（已被固定指派的時段亦計入總時數）
// 2. 在不影響第 1 點的前提下，盡量避免同一位老師連續兩個時段都要值勤
//    （即每節之間盡量有一節休息時間，包括與固定指派的時段之間）
// 3. 在不影響第 1、2 點的前提下，盡量令每位老師同時有高年班及低年班的值勤，
//    避免全部都是高年班或全部都是低年班
// duration in minutes, computed from HH:MM strings

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
 * @param {Array<{id:number, start_time:string, end_time:string,
 *   duties: Array<{id:number, name:string, needed_count:number, lockedSeats?:Map<number,number>}>,
 *   unavailable: Set<number>}>} timeSlots - 必須按時間順序排列。
 *   lockedSeats 為「固定指派」的座位（slot_index -> teacher_id），
 *   這些座位不會被重新分配，但會計入該老師的總時數及休息判斷。
 * @returns {Array<{duty_id:number, slot_index:number, teacher_id:number|null}>}
 *   僅包含未鎖定、由演算法分配的座位。
 */
function generateAssignments(teachers, timeSlots) {
  const load = new Map(teachers.map((t) => [t.id, 0]));
  // 每位老師已獲分配的高年班及低年班次數，用於第 3 點的年段平衡
  const gradeCounts = new Map(teachers.map((t) => [t.id, { high: 0, low: 0 }]));
  const results = [];

  // 預先計算每個時段中「固定指派」的老師，用於休息判斷及總時數計算
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

  // 上一個時段被分配到值勤的老師（用於避免連續兩節值勤）
  let prevSlotTeachers = new Set();

  for (let i = 0; i < timeSlots.length; i++) {
    const slot = timeSlots[i];
    const duration = durationMinutes(slot.start_time, slot.end_time);

    // 收集此時段需要填滿的座位（不含已固定指派的座位），隨機排序，
    // 令重複按「重新分配」時有不同結果
    const seats = [];
    for (const duty of slot.duties) {
      for (let s = 0; s < duty.needed_count; s++) {
        if (duty.lockedSeats && duty.lockedSeats.has(s)) continue;
        seats.push({ duty_id: duty.id, slot_index: s, duty_name: duty.name });
      }
    }
    shuffle(seats);

    // 固定指派的老師視為此時段已值勤，並計入其總時數及年段次數
    const busyInSlot = new Set(lockedBusyBySlot[i]);
    for (const duty of slot.duties) {
      if (!duty.lockedSeats) continue;
      for (const teacherId of duty.lockedSeats.values()) {
        if (teacherId == null) continue;
        if (load.has(teacherId)) load.set(teacherId, load.get(teacherId) + duration);
        const gc = gradeCounts.get(teacherId);
        if (gc) {
          if (HIGH_GRADE.has(duty.name)) gc.high++;
          else if (LOW_GRADE.has(duty.name)) gc.low++;
        }
      }
    }

    // 除了避免與上一節相同，亦盡量避免與下一節「固定指派」的老師相同（讓對方在固定值勤前有一節休息）
    const nextLockedBusy = lockedBusyBySlot[i + 1] || new Set();
    const avoidForRest = new Set([...prevSlotTeachers, ...nextLockedBusy]);

    for (const seat of seats) {
      let pool = teachers.filter((t) => !busyInSlot.has(t.id) && !slot.unavailable.has(t.id));
      if (pool.length === 0) pool = teachers.filter((t) => !busyInSlot.has(t.id));
      if (pool.length === 0) pool = teachers;

      if (pool.length === 0) {
        results.push({ duty_id: seat.duty_id, slot_index: seat.slot_index, teacher_id: null });
        continue;
      }

      // 優先選擇上一節沒有值勤、且下一節沒有固定值勤的老師（即可以有一節休息），
      // 除非全部候選人都不符合
      const restedPool = pool.filter((t) => !avoidForRest.has(t.id));
      const primaryPool = restedPool.length > 0 ? restedPool : pool;

      const minLoad = Math.min(...primaryPool.map((t) => load.get(t.id)));
      const candidates = primaryPool.filter((t) => load.get(t.id) === minLoad);

      // 第三優先：在總時數相同的候選人中，盡量選擇已有相反年段值勤的老師，
      // 避免全部都是高年班或全部都是低年班
      const isHigh = HIGH_GRADE.has(seat.duty_name);
      const isLow = LOW_GRADE.has(seat.duty_name);
      let finalCandidates = candidates;
      if (isHigh || isLow) {
        const mixedCandidates = candidates.filter((t) => {
          const gc = gradeCounts.get(t.id);
          return isHigh ? gc.low > 0 : gc.high > 0;
        });
        if (mixedCandidates.length > 0) finalCandidates = mixedCandidates;
      }

      const chosen = finalCandidates[Math.floor(Math.random() * finalCandidates.length)];

      load.set(chosen.id, load.get(chosen.id) + duration);
      busyInSlot.add(chosen.id);
      const gc = gradeCounts.get(chosen.id);
      if (gc) {
        if (HIGH_GRADE.has(seat.duty_name)) gc.high++;
        else if (LOW_GRADE.has(seat.duty_name)) gc.low++;
      }

      results.push({ duty_id: seat.duty_id, slot_index: seat.slot_index, teacher_id: chosen.id });
    }

    prevSlotTeachers = busyInSlot;
  }

  return results;
}

module.exports = { generateAssignments, durationMinutes, toMinutes };
