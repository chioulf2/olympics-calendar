import cheerio from "cheerio";
import Debug from "debug";
import fs from "fs";
import autoprefixer from "autoprefixer";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
// @ts-ignore
import OpenCC from 'opencc-js';

import { Event, Sport } from "./types";

import { getSportIcon } from "./sports";
import { isValidNOC, getNOCName, getNOCFlag } from "./nocs";
import { generateICS } from "./ics";

const debug = Debug("paris2024:index");

const converter = OpenCC.Converter({ from: 'cn', to: 'tw' });

const convertToTraditional = (text: string): string => {
  return converter(text);
};

const downloadSchedule = async (sportKey: string) => {
  debug(`檢查 ${sportKey} 的賽程`);
  const cacheFile = `${__dirname}/../cache/${sportKey}.html`;

  if (!fs.existsSync(cacheFile)) {
    debug(`下載 ${sportKey} 的賽程 https://olympics.com/zh/paris-2024/schedule/${sportKey}`);
    const response = await fetch(`https://olympics.com/zh/paris-2024/schedule/${sportKey}`);
    const content = await response.text();
    const traditionalContent = convertToTraditional(content);
    fs.writeFileSync(cacheFile, traditionalContent);
  }

  const html = fs.readFileSync(cacheFile, "utf-8");
  const $ = cheerio.load(html);
  return JSON.parse($("#__NEXT_DATA__").text());
};

const EVENTS: Event[] = [];
const NOCS: string[] = [];
const SPORTS: Sport[] = [];

const addNOC = (noc: string) => {
  debug(`添加 NOC ${noc}`);
  if (!NOCS.includes(noc)) {
    NOCS.push(noc);
  }
};

const addSport = (sportKey: string, sportName: string) => {
  debug(`添加運動項目 ${sportKey}`);
  if (!SPORTS.find((sport) => sport.key === sportKey)) {
    SPORTS.push({ key: sportKey, name: sportName, NOCS: [] });
  }
};

const addSportNOC = (sportKey: string, sportName: string, noc: string) => {
  debug(`添加 NOC ${noc} 到運動項目 ${sportKey}`);
  addSport(sportKey, sportName);
  const sport = SPORTS.find((sport) => sport.key === sportKey)!;
  if (!sport.NOCS.includes(noc)) {
    sport.NOCS.push(noc);
  }
};

const generateCalendars = () => {
  SPORTS
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'))
    .forEach((sport) => {
      let events = EVENTS
        .filter((event) => event._SPORT === sport.key)
        .sort((a, b) => a.UID.localeCompare(b.UID));
      let key = `${sport.key}/general`;
      let title = `${getSportIcon(sport.key)} ${sport.name} | 巴黎2024`;
      generateICS(title, key, events);

      events = EVENTS
        .filter((event) => event._SPORT === sport.key && event._MEDAL)
        .sort((a, b) => a.UID.localeCompare(b.UID));
      key = `${sport.key}/medals`;
      title = `${getSportIcon(sport.key)} ${sport.name} 🏅 | 巴黎2024`;
      generateICS(title, key, events);

      sport.NOCS.forEach((noc) => {
        events = EVENTS
          .filter((event) => event._SPORT === sport.key && event._NOCS.includes(noc))
          .sort((a, b) => a.UID.localeCompare(b.UID));
        key = `${sport.key}/${noc}`;
        title = `${getNOCFlag(noc)} ${getNOCName(noc)} ${sport.name} | 巴黎2024`;
        generateICS(title, key, events);
      });
    });

  NOCS.sort()
    .forEach((noc) => {
      let events = EVENTS
        .filter((event) => event._NOCS.includes(noc))
        .sort((a, b) => a.UID.localeCompare(b.UID));
      let key = `general/${noc}`;
      let title = `${getNOCFlag(noc)} ${getNOCName(noc)} | 巴黎2024`;
      generateICS(title, key, events);

      events = EVENTS
        .filter((event) => event._NOCS.includes(noc) && event._MEDAL)
        .sort((a, b) => a.UID.localeCompare(b.UID));
      if (events.length) {
        key = `medals/${noc}`;
        title = `${getNOCFlag(noc)} ${getNOCName(noc)} 🏅 | 巴黎2024`;
        generateICS(title, key, events);
      }
    });

  const events = EVENTS
    .sort((a, b) => a.UID.localeCompare(b.UID));
  const key = "general/general";
  const title = "巴黎2024";
  generateICS(title, key, events);

  const medalEvents = EVENTS
    .filter((event) => event._MEDAL)
    .sort((a, b) => a.UID.localeCompare(b.UID));
  const medalKey = "medals/general";
  const medalTitle = "🏅 巴黎2024";
  if (medalEvents.length) {
    generateICS(medalTitle, medalKey, medalEvents);
  }
};

const slugify = (text: string) => text.toLowerCase().replace(/\s/g, "-")
  .replace(/[^a-z0-9-]/g, "")
  .replace(/-+/g, "-");

const extractSportCalendar = async (sportKey: string) => {
  const data = await downloadSchedule(sportKey);
  const sportName = convertToTraditional(data.query.pDisciplineLabel);
  const sportIcon = getSportIcon(sportKey);
  addSport(sportKey, sportName);

  data.props.pageProps.scheduleDataSource.initialSchedule.units.forEach((unit: any) => {
    unit.startDateTimeUtc = new Date(unit.startDate).toISOString().replace(".000", "");
    unit.endDateTimeUtc = new Date(unit.endDate).toISOString().replace(".000", "");

    const event: Event = {
      UID: `${unit.startDateTimeUtc.replace(/[:-]/g, "")}-${sportKey}-${slugify(unit.eventUnitName).toUpperCase()}`,
      DTSTAMP: unit.startDateTimeUtc.replace(/[:-]/g, ""),
      DTSTART: unit.startDateTimeUtc.replace(/[:-]/g, ""),
      DTEND: unit.endDateTimeUtc.replace(/[:-]/g, ""),
      DESCRIPTION: `${sportName} - ${convertToTraditional(unit.eventUnitName)}`,
      SUMMARY: `${sportIcon} ${convertToTraditional(unit.eventUnitName)}`.trim(),
      LOCATION: convertToTraditional(unit.venueDescription),
      _SPORT: sportKey,
      _NOCS: [],
      _COMPETITORS: [],
      _UNITNAME: convertToTraditional(unit.eventUnitName),
      _MEDAL: !!unit.medalFlag,
      _GENDER: unit.genderCode,
    };

    if (unit.competitors) {
      const competitors = unit.competitors
        .filter((competitor: any) => competitor.noc && isValidNOC(competitor.noc))
        .sort((a: any, b: any) => a.order > b.order ? 1 : -1);
      event._NOCS = competitors.map((competitor: any) => {
        addSportNOC(sportKey, sportName, competitor.noc);
        addNOC(competitor.noc);
        return competitor.noc;
      });

      // two competitors, we put them in the summary
      if (competitors.length === 2) {
        const competitor1 = competitors.shift();
        const competitor2 = competitors.shift();

        event.UID += `-${competitor1.noc}-${competitor2.noc}`;
        if (competitor1.name !== getNOCName(competitor1.noc)) {
          event.SUMMARY = `${sportIcon} ${convertToTraditional(competitor1.name)} ${getNOCFlag(competitor1.noc)} - ${getNOCFlag(competitor2.noc)} ${convertToTraditional(competitor2.name)}`;
        } else {
          event.SUMMARY = `${sportIcon} ${competitor1.noc} ${getNOCFlag(competitor1.noc)} - ${getNOCFlag(competitor2.noc)} ${competitor2.noc}`;
        }
      } else if (competitors.length !== 0) {
        // more than two, we put them in the description
        competitors
          .sort((a: any, b: any) => convertToTraditional(a.name).localeCompare(convertToTraditional(b.name), 'zh-TW'))
          .forEach((competitor: any) => {
            if (competitor.name !== getNOCName(competitor.noc)) {
              event.DESCRIPTION += `\\n${getNOCFlag(competitor.noc)} ${convertToTraditional(competitor.name)}`;
              event._COMPETITORS.push({ noc: competitor.noc, name: `${getNOCFlag(competitor.noc)} ${convertToTraditional(competitor.name)}` });
            } else {
              event.DESCRIPTION += `\\n${getNOCFlag(competitor.noc)} ${competitor.noc}`;
            }
          });
      }
    }
    EVENTS.push(event);
  });
};

const generateCeremoniesEvents = () => {
  let startDateUtc = new Date("2024-07-26T17:30:00Z").toISOString().replace(".000", "");
  let endDateUtc = new Date("2024-07-26T21:00:00Z").toISOString().replace(".000", "");

  const openingCeremony: Event = {
    UID: `${startDateUtc.replace(/[:-]/g, "")}-opening-ceremony`,
    DTSTAMP: startDateUtc.replace(/[:-]/g, ""),
    DTSTART: startDateUtc.replace(/[:-]/g, ""),
    DTEND: endDateUtc.replace(/[:-]/g, ""),
    DESCRIPTION: convertToTraditional("巴黎2024 - 開幕式"),
    SUMMARY: convertToTraditional("巴黎2024 - 開幕式"),
    LOCATION: convertToTraditional("巴黎"),
    _NOCS: NOCS,
    _MEDAL: false,
    _COMPETITORS: [],
    _GENDER: "",
    _SPORT: "",
    _UNITNAME: "",
  };

  startDateUtc = new Date("2024-08-11T19:00:00Z").toISOString().replace(".000", "");
  endDateUtc = new Date("2024-08-11T21:15:00Z").toISOString().replace(".000", "");

  const closingCeremony: Event = {
    UID: `${startDateUtc.replace(/[:-]/g, "")}-closing-ceremony`,
    DTSTAMP: startDateUtc.replace(/[:-]/g, ""),
    DTSTART: startDateUtc.replace(/[:-]/g, ""),
    DTEND: endDateUtc.replace(/[:-]/g, ""),
    DESCRIPTION: convertToTraditional("巴黎2024 - 閉幕式"),
    SUMMARY: convertToTraditional("巴黎2024 - 閉幕式"),
    LOCATION: convertToTraditional("法蘭西體育場，聖但尼"),
    _NOCS: NOCS,
    _MEDAL: false,
    _COMPETITORS: [],
    _GENDER: "",
    _SPORT: "",
    _UNITNAME: "",
  };

  EVENTS.push(openingCeremony);
  EVENTS.push(closingCeremony);
};

const generateOutputPage = () => {
  const html = [];

  const linkClass = "inline-block bg-slate-400 hover:bg-blue-400 text-white px-2 py-1 my-px whitespace-nowrap rounded-lg text-base";

  html.push("<table>");

  html.push("<tr class=\"even:bg-slate-200\">");
  html.push("<th class=\"font-bold text-left whitespace-nowrap\">所有運動項目</td>");
  html.push("<td class=\"text-center\">");
  html.push(`<a href="general/general.ics" class="${linkClass}">完整賽程</a>`);
  if (fs.existsSync(`${__dirname}/../docs/medals/general.ics`)) {
    html.push(`<br/><a href="medals/general.ics" class="${linkClass}">🏅 獎牌賽事</a>`);
  }
  html.push("</td>");
  html.push("<td>");
  NOCS.sort().forEach((noc) => {
    html.push(`<a href="general/${noc}.ics" class="${linkClass}">${getNOCFlag(noc)} ${noc} ${getNOCName(noc)}</a>`);
  });
  html.push("</td>");
  html.push("</tr>");

  html.push("<tr class=\"even:bg-slate-200\">");
  html.push("<th class=\"font-bold text-left whitespace-nowrap\">🏅 獎牌賽事</td>");
  html.push("<td class=\"text-center\">");
  html.push(`<a href="medals/general.ics" class="${linkClass}">完整賽程</a>`);
  html.push("</td>");
  html.push("<td>");
  fs.readdirSync(`${__dirname}/../docs/medals`)
    .filter((ics) => ics !== "general.ics")
    .forEach((ics) => {
      const noc = ics.replace(".ics", "");
      html.push(`<a href="medals/${noc}.ics" class="${linkClass}">${getNOCFlag(noc)} ${noc} ${getNOCName(noc)}</a>`);
    });
  html.push("</td>");
  html.push("</tr>");

  SPORTS.map((sport) => {
    html.push("<tr class=\"even:bg-slate-200\">");
    html.push(`<th class="font-bold text-left whitespace-nowrap">${getSportIcon(sport.key)} ${sport.name}</td>`);
    html.push("<td class=\"text-center\">");
    html.push(`<a href="${sport.key}/general.ics" class="${linkClass}">完整賽程</a>`);
    if (fs.existsSync(`${__dirname}/../docs/${sport.key}/medals.ics`)) {
      html.push(`<br/><a href="${sport.key}/medals.ics" class="${linkClass}">🏅 獎牌賽事</a>`);
    }
    html.push("</td>");
    html.push("<td>");
    sport.NOCS.sort().forEach((noc) => {
      html.push(`<a href="${sport.key}/${noc}.ics" class="${linkClass}">${getNOCFlag(noc)} ${noc} ${getNOCName(noc)}</a>`);
    });
    html.push("</td>");
    html.push("</tr>");
  });
  html.push("</table>");

  const todays: string[] = [];
  NOCS.sort().forEach((noc) => {
    todays.push(`<a href="./today.html?noc=${noc}&country=${getNOCName(noc)}" class="${linkClass}">${getNOCFlag(noc)} ${noc} ${getNOCName(noc)}</a>`);
  });

   // 新增的全部赛程链接部分
   const alls: string[] = [];
   NOCS.sort().forEach((noc) => {
     alls.push(`<a href="./all.html?noc=${noc}&country=${getNOCName(noc)}" class="${linkClass}">${getNOCFlag(noc)} ${noc} ${getNOCName(noc)}</a>`);
   });

  const template = fs.readFileSync(`${__dirname}/index/template.html`, "utf-8");
  const output = template
    .replace("{{calendars}}", html.join("\r\n"))
    .replace("{{todays}}", todays.join("\r\n"))
    .replace("{{alls}}", alls.join("\r\n"));  // 新增的替换
  fs.writeFileSync("docs/index.html", output);
};

const generateTodayPage = () => {
  const html: string[] = [];

  EVENTS.forEach((event) => {
    let sport = SPORTS.find((sport) => sport.key === event._SPORT);
    if (!sport) {
      sport = {
        name: convertToTraditional("儀式"),
        key: "",
        NOCS: [],
      };
    }
    const summary = event.SUMMARY.match(/ceremony/gi) ? event.SUMMARY : event.SUMMARY.split(" ").slice(1).join(" ");

    html.push(`<div class="event py-4" data-start="${event.DTSTART}" data-end="${event.DTEND}" data-noc="${event._NOCS.join(",")}">`);
    html.push('<div class="time w-1/4 align-top text-right inline-block text-5xl text-center tabular-nums pr-2 border-r border-slate-900/10">__:__</div>');
    html.push('<div class="w-3/5 align-top inline-block text-black pl-2">');
    html.push('  <div class="text-2xl">');
    html.push(`  ${event._MEDAL ? "🏅" : ""}`);
    html.push(`  ${sport.name.toUpperCase()}`);
    if (event._GENDER === "M") {
      html.push('  <span class="text-xs align-middle bg-blue-400 text-white py-1 px-2 rounded-xl">男</span>');
    } else if (event._GENDER === "W") {
      html.push('  <span class="text-xs align-middle bg-pink-400 text-white py-1 px-2 rounded-xl">女</span>');
    }
    html.push('  </div>');
    if (event._UNITNAME.match(summary)) {
      html.push(`  <div class="">${summary}`);
    } else {
      html.push(`  <div class="">${event._UNITNAME}`);
      html.push(`  <div class="">${summary}</div>`);
    }
    if (event._COMPETITORS) {
      event._COMPETITORS.forEach((competitor) => {
        html.push(`<div class="competitor ${competitor.noc}">${competitor.name}</div>`);
      });
    }
    html.push('  </div>');
    html.push('</div>');
    html.push('</div>');
  });

  const template = fs.readFileSync(`${__dirname}/today/template.html`, "utf-8");
  const output = template
    .replace("{{events}}", html.join("\r\n"));
  fs.writeFileSync("docs/today.html", output);
};

//新增的
const generateAllPage = () => {
  const html: string[] = [];

  EVENTS.forEach((event) => {
    let sport = SPORTS.find((sport) => sport.key === event._SPORT);
    if (!sport) {
      sport = {
        name: convertToTraditional("儀式"),
        key: "",
        NOCS: [],
      };
    }
    const summary = event.SUMMARY.match(/ceremony/gi) ? event.SUMMARY : event.SUMMARY.split(" ").slice(1).join(" ");

    html.push(`<div class="event py-4" data-start="${event.DTSTART}" data-end="${event.DTEND}" data-noc="${event._NOCS.join(",")}">`);
    html.push('<div class="time w-1/4 align-top text-right inline-block text-5xl text-center tabular-nums pr-2 border-r border-slate-900/10">__:__</div>');
    html.push('<div class="w-3/5 align-top inline-block text-black pl-2">');
    html.push('  <div class="text-2xl">');
    html.push(`  ${event._MEDAL ? "🏅" : ""}`);
    html.push(`  ${sport.name.toUpperCase()}`);
    if (event._GENDER === "M") {
      html.push('  <span class="text-xs align-middle bg-blue-400 text-white py-1 px-2 rounded-xl">男</span>');
    } else if (event._GENDER === "W") {
      html.push('  <span class="text-xs align-middle bg-pink-400 text-white py-1 px-2 rounded-xl">女</span>');
    }
    html.push('  </div>');
    if (event._UNITNAME.match(summary)) {
      html.push(`  <div class="">${summary}`);
    } else {
      html.push(`  <div class="">${event._UNITNAME}`);
      html.push(`  <div class="">${summary}</div>`);
    }
    if (event._COMPETITORS) {
      event._COMPETITORS.forEach((competitor) => {
        html.push(`<div class="competitor ${competitor.noc}">${competitor.name}</div>`);
      });
    }
    html.push('  </div>');
    html.push('</div>');
    html.push('</div>');
  });

  const template = fs.readFileSync(`${__dirname}/all/template.html`, "utf-8");
  const output = template
    .replace("{{events}}", html.join("\r\n"));
  fs.writeFileSync("docs/all.html", output);
};


const generateCSS = () => {
  postcss([autoprefixer, tailwindcss])
    .process(fs.readFileSync(`${__dirname}/index/template.css`, "utf-8"), { from: "index/template.css", to: "docs/style.css" })
    .then((result) => {
      fs.writeFileSync("docs/style.css", result.css);
    });
};

const main = async () => {
  await Promise.all(
    [
      "3x3-basketball",
      "archery",
      "artistic-gymnastics",
      "artistic-swimming",
      "athletics",
      "badminton",
      "basketball",
      "beach-volleyball",
      "boxing",
      "breaking",
      "canoe-slalom",
      "canoe-sprint",
      "cycling-bmx-freestyle",
      "cycling-bmx-racing",
      "cycling-mountain-bike",
      "cycling-road",
      "cycling-track",
      "diving",
      "equestrian",
      "fencing",
      "football",
      "golf",
      "handball",
      "hockey",
      "judo",
      "marathon-swimming",
      "modern-pentathlon",
      "rhythmic-gymnastics",
      "rowing",
      "rugby-sevens",
      "sailing",
      "shooting",
      "skateboarding",
      "sport-climbing",
      "surfing",
      "swimming",
      "table-tennis",
      "taekwondo",
      "tennis",
      "trampoline-gymnastics",
      "triathlon",
      "volleyball",
      "water-polo",
      "weightlifting",
      "wrestling",
    ]
      .map((key) => extractSportCalendar(key)),
  );
  generateCeremoniesEvents();
  generateCalendars();
  generateOutputPage();
  generateTodayPage();
  //新增的
  generateAllPage();
  generateCSS();
};

main();