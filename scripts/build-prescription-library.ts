import fs from "node:fs";
import path from "node:path";
import { contentByCourseForVerification } from "C:/Users/ASUS/Documents/AcuAcu/src/App";
import { extractPoints } from "C:/Users/ASUS/Documents/AcuAcu/src/pointMeta";
import dataset from "C:/Users/ASUS/Documents/AcuAcu/data/acu3-course-organ-system-chart.json";

type Source = { document: string; page?: string | number; section?: string };
type AuditPattern = { name: string; status: string; sourcesChecked?: Source[] };
type AuditCondition = { courseNumber: number; patterns: AuditPattern[] };

const acuAcuRoot = "C:/Users/ASUS/Documents/AcuAcu";
const audit = JSON.parse(fs.readFileSync(path.join(acuAcuRoot, "data/clinical-content-audit.json"), "utf8")) as {
  conditions: AuditCondition[];
};
const pointData = JSON.parse(fs.readFileSync(path.resolve("public/acupuncture-data.json"), "utf8")) as {
  points: Array<{ id: string }>;
};
const available = new Set(pointData.points.map((point) => point.id));
const auditByCourse = new Map(audit.conditions.map((condition) => [condition.courseNumber, condition]));

const normalize = (value: string) => value.replace(/\s+/g, "").toUpperCase();
const records = dataset.items.flatMap((condition) => {
  const content = contentByCourseForVerification[condition.courseNumber as keyof typeof contentByCourseForVerification];
  const auditCondition = auditByCourse.get(condition.courseNumber);
  if (!content) return [];
  return content.patterns.flatMap((pattern, index) => {
    const allPoints = [
      ...extractPoints(pattern.points),
      ...(pattern.pointAdditions ?? []).flatMap((addition) => extractPoints(addition.points)),
    ].map(normalize);
    const points = [...new Set(allPoints.filter((point) => available.has(point)))];
    if (!points.length) return [];
    const auditPattern = auditCondition?.patterns[index];
    const sources = (auditPattern?.sourcesChecked ?? []).map((source) => ({
      title: path.basename(source.document, path.extname(source.document)),
      page: source.page ?? null,
      section: source.section ?? null,
      kind: source.document.includes("/textbooks/") ? "textbook" : "course",
    }));
    return [{
      id: `acuacu-${condition.courseNumber}-${index + 1}`,
      title: `${condition.diseaseName} — ${pattern.name}`,
      condition: condition.diseaseName,
      pattern: pattern.name,
      system: condition.organSystem,
      points,
      description: pattern.principle,
      additions: (pattern.pointAdditions ?? []).map((addition) => ({
        indication: addition.indication,
        points: extractPoints(addition.points).map(normalize).filter((point) => available.has(point)),
      })).filter((addition) => addition.points.length),
      status: auditPattern?.status ?? "pending",
      sources,
      sourceFile: condition.sourceFile,
    }];
  });
});

const library = {
  schema: "acu-map-prescription-library",
  version: 1,
  generatedFrom: "AcuAcu source-reviewed clinical library",
  generatedAt: new Date().toISOString(),
  notice: "Study reference only. Point combinations and clinical content remain pending independent practitioner review.",
  records,
};

fs.writeFileSync(path.resolve("public/prescription-library.json"), `${JSON.stringify(library, null, 2)}\n`);
console.log(`Wrote ${records.length} prescription combinations with ${records.reduce((sum, item) => sum + item.points.length, 0)} mapped point references.`);
