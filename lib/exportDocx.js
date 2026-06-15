const {
  Document,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  VerticalAlign,
  PageOrientation,
  HeadingLevel,
} = require('docx');

function formatMinutes(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}時${m}分`;
  if (h) return `${h}時`;
  return `${m}分`;
}

const CELL_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 2, color: '999999' },
  bottom: { style: BorderStyle.SINGLE, size: 2, color: '999999' },
  left: { style: BorderStyle.SINGLE, size: 2, color: '999999' },
  right: { style: BorderStyle.SINGLE, size: 2, color: '999999' },
};

function cell(lines, { header = false, align = AlignmentType.CENTER, width } = {}) {
  const values = Array.isArray(lines) ? lines : [lines];
  return new TableCell({
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    shading: header ? { fill: 'EEF3F0' } : undefined,
    borders: CELL_BORDERS,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: values.map(
      (value) =>
        new Paragraph({
          alignment: align,
          children: [new TextRun({ text: String(value), bold: header })],
        })
    ),
  });
}

/**
 * 建立與分工表格式一致的 Word 文件：以老師為列、時段為欄的值勤分配表。
 * @param {{schedule: object, timeSlots: Array, teachers: Array}} data
 */
function buildScheduleDocument({ schedule, timeSlots, teachers }) {
  const activeTeachers = teachers.filter((t) => t.active);

  const totals = new Map(teachers.map((t) => [t.id, { minutes: 0, count: 0 }]));
  const cellMap = new Map();

  for (const slot of timeSlots) {
    for (const duty of slot.duties) {
      for (const a of duty.assignments) {
        if (!a.teacher_id) continue;
        const key = `${a.teacher_id}_${slot.id}`;
        if (!cellMap.has(key)) cellMap.set(key, []);
        cellMap.get(key).push(duty.name);
        const total = totals.get(a.teacher_id);
        if (total) {
          total.minutes += slot.duration_min;
          total.count += 1;
        }
      }
    }
  }

  const nameColWidth = 1500;
  const totalColWidth = 1100;
  const slotColWidth = timeSlots.length
    ? Math.max(900, Math.floor((10000 - nameColWidth - totalColWidth * 2) / timeSlots.length))
    : 900;

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      cell('老師', { header: true, width: nameColWidth }),
      ...timeSlots.map((slot) =>
        cell([slot.label, `${slot.start_time}-${slot.end_time}`], { header: true, width: slotColWidth })
      ),
      cell('總值勤時數', { header: true, width: totalColWidth }),
      cell('總次數', { header: true, width: totalColWidth }),
    ],
  });

  const bodyRows = activeTeachers.map((t) => {
    const total = totals.get(t.id);
    return new TableRow({
      children: [
        cell(t.name, { align: AlignmentType.LEFT, width: nameColWidth }),
        ...timeSlots.map((slot) => {
          const duties = cellMap.get(`${t.id}_${slot.id}`) || [];
          return cell(duties.length ? duties : '-', { width: slotColWidth });
        }),
        cell(formatMinutes(total.minutes), { width: totalColWidth }),
        cell(String(total.count), { width: totalColWidth }),
      ],
    });
  });

  if (activeTeachers.length === 0) {
    bodyRows.push(
      new TableRow({
        children: [cell('尚未新增在職老師', { align: AlignmentType.LEFT, width: nameColWidth })],
      })
    );
  }

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...bodyRows],
  });

  const titleParts = [schedule.name];
  if (schedule.date) titleParts.push(schedule.date);

  return new Document({
    sections: [
      {
        properties: {
          page: {
            size: { orientation: PageOrientation.LANDSCAPE },
            margin: { top: 720, bottom: 720, left: 600, right: 600 },
          },
        },
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: titleParts.join('　'), bold: true })],
          }),
          new Paragraph({ text: '' }),
          table,
        ],
      },
    ],
  });
}

module.exports = { buildScheduleDocument };
