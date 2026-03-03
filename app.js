const express = require("express");

const KOREAN_WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];

let adapterPromise = null;
let appPromise = null;

async function createComciganAdapter() {
  const Timetable = require("comcigan-parser");
  const instance = new Timetable();
  await instance.init();

  return {
    async searchSchool(keyword) {
      return instance.search(keyword);
    },
    async getTimetable({ schoolCode, grade, classNum, maxGrade = 3 }) {
      instance._option = Object.assign({}, instance._option, { maxGrade });
      instance.setSchool(Number(schoolCode));
      const allTimetables = await instance.getTimetable();

      if (!allTimetables?.[grade]?.[classNum]) {
        throw new Error(`Timetable not found for grade ${grade} class ${classNum}`);
      }

      return allTimetables[grade][classNum];
    },
  };
}

function getAdapter() {
  if (!adapterPromise) {
    adapterPromise = createComciganAdapter();
  }
  return adapterPromise;
}

function weekInfoForDate(dateText) {
  const target = parseDateParts(dateText);
  if (!target) {
    throw new Error("target_date must use YYYY-MM-DD format");
  }

  const seoulNow = seoulDatePartsNow();

  const currentMonday = startOfWeek(seoulNow);
  const targetMonday = startOfWeek(target);
  const diffDays = Math.round((targetMonday - currentMonday) / 86400000);

  if (diffDays !== 0 && diffDays !== 7) {
    return {
      ok: false,
      today: formatIsoDate(seoulNow),
      current_week: {
        from: formatIsoDate(currentMonday),
        to: formatIsoDate(addDays(currentMonday, 6)),
      },
      next_week: {
        from: formatIsoDate(addDays(currentMonday, 7)),
        to: formatIsoDate(addDays(currentMonday, 13)),
      },
    };
  }

  return {
    ok: true,
    weekNum: diffDays / 7,
    weekdayIndex: weekdayIndexMondayFirst(target),
    weekdayName: KOREAN_WEEKDAYS[weekdayIndexMondayFirst(target)],
  };
}

function startOfWeek(date) {
  const copy = new Date(date);
  const mondayFirst = weekdayIndexMondayFirst(copy);
  copy.setDate(copy.getDate() - mondayFirst);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function weekdayIndexMondayFirst(date) {
  return (date.getDay() + 6) % 7;
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function parseDateParts(dateText) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function seoulDatePartsNow() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function normalizeSchool(candidate) {
  if (Array.isArray(candidate)) {
    return {
      school_code: String(candidate[0] ?? ""),
      region_name: String(candidate[1] ?? ""),
      school_name: String(candidate[2] ?? ""),
      school_type: String(candidate[3] ?? ""),
      raw: candidate,
    };
  }

  if (candidate && typeof candidate === "object") {
    return {
      school_code: String(candidate.schoolCode ?? candidate.school_code ?? candidate.code ?? ""),
      region_name: String(candidate.region ?? candidate.region_name ?? candidate.local_name ?? ""),
      school_name: String(candidate.name ?? candidate.school_name ?? candidate.schoolName ?? ""),
      school_type: String(candidate.schoolType ?? candidate.school_type ?? candidate.type ?? ""),
      raw: candidate,
    };
  }

  return {
    school_code: "",
    region_name: "",
    school_name: String(candidate ?? ""),
    school_type: "",
    raw: candidate,
  };
}

function normalizePeriod(period, fallbackPeriod) {
  if (!period) {
    return {
      period: fallbackPeriod,
      subject: "",
      teacher: "",
      display_text: "",
      is_substitution: false,
      is_placeholder: true,
      raw: period,
    };
  }

  const subject = String(period.subject ?? "").trim();
  const teacher = String(period.teacher ?? "").trim();
  const display = [subject, teacher].filter(Boolean).join(" / ");

  return {
    period: fallbackPeriod,
    subject,
    teacher,
    display_text: display,
    is_substitution: String(period.subject ?? "").includes("(대체)") || String(period.teacher ?? "").includes("(대체)"),
    is_placeholder: !subject,
    raw: period,
  };
}

function normalizeWeeklyGrid(timetableByDay) {
  if (!Array.isArray(timetableByDay)) {
    throw new Error(`Unexpected timetable shape: ${typeof timetableByDay}`);
  }

  return timetableByDay.map((day, weekdayIndex) => ({
    weekday_index: weekdayIndex,
    weekday_name_ko: KOREAN_WEEKDAYS[weekdayIndex] || `day-${weekdayIndex}`,
    periods: Array.isArray(day)
      ? day.map((period, idx) => normalizePeriod(period, idx + 1))
      : [],
  }));
}

function selectSchool(schools, { schoolName, regionName, schoolCode }) {
  let matches = schools;

  if (schoolCode) {
    matches = matches.filter((school) => school.school_code === String(schoolCode));
  }

  if (schoolName) {
    matches = matches.filter((school) => school.school_name === schoolName);
  }

  if (regionName) {
    matches = matches.filter((school) => school.region_name === regionName);
  }

  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    const error = new Error("No exact school match found");
    error.statusCode = 404;
    error.payload = { schools };
    throw error;
  }

  const error = new Error("Multiple schools matched");
  error.statusCode = 409;
  error.payload = { schools: matches };
  throw error;
}

async function createApp() {
  const app = express();

  app.get("/", (_req, res) => {
    res.json({
      status: "ok",
      service: "comci-direct-server",
      endpoints: ["/health", "/meta", "/schools/search", "/timetable/verify"],
    });
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/meta", (_req, res) => {
    const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    const currentMonday = startOfWeek(today);
    res.json({
      timezone: "Asia/Seoul",
      today: formatIsoDate(today),
      current_week: {
        week_num: 0,
        monday: formatIsoDate(currentMonday),
        sunday: formatIsoDate(addDays(currentMonday, 6)),
      },
      next_week: {
        week_num: 1,
        monday: formatIsoDate(addDays(currentMonday, 7)),
        sunday: formatIsoDate(addDays(currentMonday, 13)),
      },
      source: "comcigan-parser direct HTML table parsing",
    });
  });

  app.get("/schools/search", async (req, res, next) => {
    try {
      const adapter = await getAdapter();
      const query = String(req.query.q || "").trim();
      if (!query) {
        return res.status(400).json({ message: "q is required" });
      }

      const result = await adapter.searchSchool(query);
      const schools = Array.isArray(result) ? result.map(normalizeSchool) : [];
      res.json({ query, count: schools.length, schools });
    } catch (error) {
      next(error);
    }
  });

  app.get("/timetable/verify", async (req, res, next) => {
    try {
      const adapter = await getAdapter();
      const schoolName = String(req.query.school_name || "").trim();
      const regionName = String(req.query.region_name || "").trim();
      const schoolCode = String(req.query.school_code || "").trim();
      const targetDate = String(req.query.target_date || "").trim();
      const grade = Number(req.query.grade);
      const classNum = Number(req.query.class_num);

      if (!targetDate || !grade || !classNum) {
        return res.status(400).json({ message: "target_date, grade, class_num are required" });
      }

      const weekInfo = weekInfoForDate(targetDate);
      if (!weekInfo.ok) {
        return res.status(422).json({
          message: "Only current week and next week are supported",
          ...weekInfo,
        });
      }

      let selectedSchool = null;
      if (schoolCode) {
        selectedSchool = {
          school_code: schoolCode,
          school_name: schoolName,
          region_name: regionName,
        };
      } else {
        const result = await adapter.searchSchool(schoolName);
        const schools = Array.isArray(result) ? result.map(normalizeSchool) : [];
        selectedSchool = selectSchool(schools, { schoolName, regionName, schoolCode });
      }

      const weeklyData = await adapter.getTimetable({
        schoolCode: Number(selectedSchool.school_code),
        grade,
        classNum,
        maxGrade: Math.max(grade, 3),
      });

      const weeklyGrid = normalizeWeeklyGrid(weeklyData);
      const dailySubjects = weeklyGrid[weekInfo.weekdayIndex]?.periods || [];

      res.json({
        school: selectedSchool,
        request: {
          target_date: targetDate,
          grade,
          class_num: classNum,
          week_num: weekInfo.weekNum,
          weekday: {
            index: weekInfo.weekdayIndex,
            name_ko: weekInfo.weekdayName,
          },
        },
        daily_subjects: dailySubjects,
        weekly_grid: weeklyGrid,
      });
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _req, res, _next) => {
    res.status(error.statusCode || 500).json({
      message: error.message || "Unexpected error",
      ...(error.payload || {}),
    });
  });

  return app;
}

function getApp() {
  if (!appPromise) {
    appPromise = createApp();
  }
  return appPromise;
}

module.exports = {
  getApp,
};
