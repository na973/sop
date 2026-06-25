import { NextRequest, NextResponse } from 'next/server';

type StrategyLevel = '极高' | '高' | '平均偏高' | '平均' | '平均偏低' | '低' | '极低';

interface CompareItemInput {
  row: number;
  category: string;
  code: string;
  name: string;
  feature?: string;
  unit: string;
  quantity: number;
  ourUnitPrice: number;
  maxUnitPrice: number;
  maxTotalPrice?: number;
  deviationRate: number;
  deviationLevel: string;
  isScreeningItem?: boolean;
  itemReviewPrice?: number;
  screeningRank?: number;
  screeningBasis?: string;
  isAbnormalBidItem?: boolean;
}

interface StrategyOverride {
  row: number;
  category: string;
  code: string;
  strategyLevel?: StrategyLevel;
  suggestion?: string;
}

interface StrategyRule {
  majorType: string;
  subType: string;
  direction: '保价' | '让利' | '让利配平';
  step: string;
  reason: string;
  level: StrategyLevel;
  profitImpact: string;
  keywords: string[];
}

const STRATEGY_RULES: StrategyRule[] = [
  rule('道路工程', '改扩建工程', '保价', '旧路破除与土方开挖', '地下管线不明，实际破除量、开挖深度可能远超招标', '极高', '+30%-60%', ['旧路破除', '破除', '土方开挖', '开挖']),
  rule('道路工程', '改扩建工程', '保价', '新旧路衔接处理', '招标通常只给原则，实际可能新增台阶开挖、玻纤格栅、搭接处理', '极高', '+50%-100%', ['新旧路', '衔接', '搭接', '玻纤格栅']),
  rule('道路工程', '改扩建工程', '保价', '地下管线迁改与保护', '管线探测不准，实际保护方案和签证量可能增加', '极高', '+40%-80%', ['管线', '迁改', '保护']),
  rule('道路工程', '改扩建工程', '保价', '旧路基补强处理', '实际承载力不足时可能新增换填、注浆', '极高', '+35%-70%', ['旧路基', '补强', '换填', '注浆']),
  rule('道路工程', '改扩建工程', '保价', '交通导改工程', '实际可能多次导改并新增临时设施', '极高', '+40%-90%', ['交通导改', '导改', '临时交通']),
  rule('道路工程', '改扩建工程', '保价', '旧桥改造与加固', '旧桥实际病害可能远超检测', '极高', '+40%-80%', ['旧桥', '桥梁加固', '支座更换', '病害']),
  rule('道路工程', '改扩建工程', '保价', '旧路灯更换与升级', '灯杆锈蚀、线路老化可能导致更换数量增加', '高', '+30%-60%', ['旧路灯', '路灯更换', '线路老化']),
  rule('道路工程', '改扩建工程', '保价', '交安设施升级改造', '旧标志、护栏可能不满足新规，升级更换量增加', '高', '+35%-70%', ['交安', '护栏', '标志', '标线', '信号']),
  rule('道路工程', '改扩建工程', '让利配平', '普通小型交通标志', '工程量小、设计明确，适合作为总价平衡项', '极低', '影响极小', ['小型交通标志', '警示标志']),
  rule('道路工程', '改扩建工程', '让利配平', '零星路缘石安装', '工程量小、变更概率低', '低', '影响极小', ['零星路缘石', '路缘石', '侧石', '平石']),
  rule('道路工程', '维修工程', '保价', '路面病害处理', '检测可能失真，实际病害量可能显著增加', '极高', '+40%-120%', ['病害', '裂缝', '坑槽', '路面维修']),
  rule('道路工程', '维修工程', '保价', '基层与底基层补强', '实际基层损坏时可能新增换填、注浆', '极高', '+60%-150%', ['基层补强', '底基层补强', '水稳', '基层']),
  rule('道路工程', '维修工程', '保价', '井盖提升与井周加固', '井周加固可能漏算，实际增量较大', '高', '+30%-80%', ['井盖', '井周', '检查井']),
  rule('道路工程', '维修工程', '保价', '排水清淤与修复', '实际堵塞严重时清淤量和管道修复增量较大', '极高', '+35%-90%', ['清淤', '排水修复', '管道修复']),
  rule('道路工程', '维修工程', '让利', '零星井盖配件', '工程量小、设计明确', '低', '影响极小', ['井盖配件', '零星配件']),
  rule('道路工程', '新建工程', '保价', '路基土石方与软基处理', '地质不准时石方、软基量差可能较大', '极高', '+25%-60%', ['路基', '土石方', '软基', '石方']),
  rule('道路工程', '新建工程', '保价', '边坡防护工程', '地质变化可能新增锚杆、挡土墙', '高', '+20%-50%', ['边坡', '锚杆', '挡土墙']),
  rule('道路工程', '新建工程', '保价', '临时工程', '便道、排水等招标估算可能不足', '高', '+25%-50%', ['便道', '临时排水', '临时工程']),
  rule('道路工程', '新建工程', '让利', '小型交通指示牌', '工程量小、设计明确', '极低', '影响极小', ['小型交通指示牌']),
  rule('道路工程', '新建工程', '让利', '零星人行道砖', '工程量小、量差有限', '低', '影响极小', ['人行道砖', '透水砖']),
  rule('房建工程', '老旧小区改造', '保价', '外墙保温与装饰', '旧基层铲除、找平可能漏算', '极高', '+40%-100%', ['外墙保温', '外墙装饰', '旧基层']),
  rule('房建工程', '老旧小区改造', '保价', '给排水管网改造', '更换长度、迁改接驳可能漏算', '极高', '+50%-120%', ['给排水', '管网改造', '接驳']),
  rule('房建工程', '老旧小区改造', '保价', '屋面防水与翻新', '找平、找坡、附加层可能增加', '极高', '+30%-80%', ['屋面防水', '屋面翻新']),
  rule('房建工程', '精装修工程', '保价', '装饰面层', '材料更换和排版损耗可能增加', '极高', '+30%-70%', ['瓷砖', '石材', '木地板', '装饰面层']),
  rule('房建工程', '精装修工程', '保价', '吊顶工程', '管线碰撞可能导致造型调整', '高', '+30%-70%', ['吊顶']),
  rule('房建工程', '商业公建', '保价', '基坑支护与土方', '地质不准时石方、支护增量较大', '极高', '+30%-70%', ['基坑', '支护', '土方']),
  rule('房建工程', '新建住宅', '保价', '土方与桩基', '桩长、入岩深度可能超招标', '高', '+20%-50%', ['桩基', '入岩']),
  rule('房建工程', '工业厂房', '保价', '地基处理工程', '承载力不足时可能新增换填、桩基', '极高', '+30%-60%', ['地基处理', '承载力']),
  rule('通用工程', '通用让利项', '让利', '普通零星项目', '工程量小、设计明确、变更概率低，适合作为配平让利项', '低', '影响极小', ['零星', '普通', '小型', '配件']),
];

const LOW_RISK_KEYWORDS = ['零星', '小型', '普通', '配件', '设计明确'];
const HIGH_RISK_KEYWORDS = ['病害', '旧', '改造', '迁改', '保护', '补强', '软基', '换填', '注浆', '支护', '桩基', '防水', '清淤'];

function rule(
  majorType: string,
  subType: string,
  direction: StrategyRule['direction'],
  step: string,
  reason: string,
  level: StrategyLevel,
  profitImpact: string,
  keywords: string[],
): StrategyRule {
  return { majorType, subType, direction, step, reason, level, profitImpact, keywords };
}

function normalizeDeviationLevel(level: string): string {
  if (level.includes('明显偏低') || level.includes('已压价')) return '控制价明显偏低/疑似已压价';
  if (level.includes('偏低')) return '控制价偏低';
  if (level.includes('明显偏高')) return '控制价明显偏高';
  if (level.includes('偏高')) return '控制价偏高';
  return '基本接近';
}

function inferOptimization(item: Pick<CompareItemInput, 'name' | 'feature'>): string {
  const text = `${item.name} ${item.feature || ''}`;
  if (containsAny(text, ['沥青上面层', '侧石', '平石', '缘石', '面砖', '花岗岩', '承台', '墩柱', '桥台', '盖梁', '伸缩缝'])) return '不能优化';
  if (containsAny(text, ['铣刨', '沥青下面层', '沥青中面层', '混凝土基层', '桥面铺装'])) return '优化较少';
  if (containsAny(text, ['清表', '场地平整', '路基填筑', '路床', '防水层', '台背回填', '路基补强'])) return '优化较多';
  if (containsAny(text, ['软基', '换填', '碎石垫层', '砂砾垫层', '宕渣垫层', '拆除基层', '凿除桥面'])) return '优化多';
  return '优化一般/需人工复核';
}

function inferProjectType(item: CompareItemInput, matchedRule?: StrategyRule): { majorType: string; subType: string } {
  if (matchedRule) return { majorType: matchedRule.majorType, subType: matchedRule.subType };
  const text = `${item.category} ${item.name} ${item.feature || ''}`;
  if (containsAny(text, ['道路', '路面', '路基', '桥梁', '排水', '交安', '路灯'])) {
    if (containsAny(text, ['维修', '病害', '清淤', '井盖'])) return { majorType: '道路工程', subType: '维修工程' };
    if (containsAny(text, ['旧', '改造', '破除', '迁改'])) return { majorType: '道路工程', subType: '改扩建工程' };
    return { majorType: '道路工程', subType: '新建工程' };
  }
  if (containsAny(text, ['外墙', '屋面', '小区'])) return { majorType: '房建工程', subType: '老旧小区改造' };
  if (containsAny(text, ['装修', '吊顶', '瓷砖', '石材'])) return { majorType: '房建工程', subType: '精装修工程' };
  if (containsAny(text, ['基坑', '公建', '商业'])) return { majorType: '房建工程', subType: '商业公建' };
  if (containsAny(text, ['厂房', '地坪', '防腐'])) return { majorType: '房建工程', subType: '工业厂房' };
  return { majorType: '待识别', subType: '待识别' };
}

function inferProjectTypeForBatch(items: CompareItemInput[]): { majorType: string; subType: string; confidence: number; basis: string } {
  const text = items.map((item) => `${item.category} ${item.name} ${item.feature || ''}`).join(' ');
  const scores = [
    scoreProjectType(text, '道路工程', '维修工程', ['维修', '病害', '清淤', '修复', '井盖', '井周', '翻新', '维护', '裂缝', '坑槽']),
    scoreProjectType(text, '道路工程', '改扩建工程', ['改扩建', '改造', '旧路', '破除', '迁改', '保护', '导改', '衔接', '旧桥', '旧路灯']),
    scoreProjectType(text, '道路工程', '新建工程', ['新建', '路基土石方', '软基', '边坡', '便道', '新建桥梁', '新建路灯', '新建交安']),
    scoreProjectType(text, '房建工程', '老旧小区改造', ['老旧小区', '外墙', '屋面', '给排水管网', '公共区域']),
    scoreProjectType(text, '房建工程', '精装修工程', ['精装修', '装饰', '吊顶', '瓷砖', '石材', '木地板']),
    scoreProjectType(text, '房建工程', '商业公建', ['商业', '公建', '基坑', '机电管线综合']),
    scoreProjectType(text, '房建工程', '新建住宅', ['住宅', '桩基', '室外配套']),
    scoreProjectType(text, '房建工程', '工业厂房', ['厂房', '地坪', '防腐', '钢结构']),
  ].sort((a, b) => b.score - a.score);
  const best = scores[0];
  if (!best || best.score <= 0) {
    return { majorType: '待识别', subType: '待识别', confidence: 0, basis: '整批清单未匹配明确项目类别关键词' };
  }
  return {
    majorType: best.majorType,
    subType: best.subType,
    confidence: best.score,
    basis: `整批清单匹配项目类别：${best.subType}（命中 ${best.score} 个关键词）`,
  };
}

function scoreProjectType(text: string, majorType: string, subType: string, keywords: string[]): {
  majorType: string;
  subType: string;
  score: number;
} {
  return {
    majorType,
    subType,
    score: keywords.reduce((count, keyword) => count + countOccurrences(text, keyword), 0),
  };
}

function countOccurrences(text: string, keyword: string): number {
  if (!keyword) return 0;
  let count = 0;
  let index = text.indexOf(keyword);
  while (index >= 0) {
    count += 1;
    index = text.indexOf(keyword, index + keyword.length);
  }
  return count;
}

function matchStrategyRule(item: CompareItemInput, projectType?: { majorType: string; subType: string }): StrategyRule | undefined {
  const text = `${item.category} ${item.name} ${item.feature || ''}`;
  return STRATEGY_RULES
    .filter((ruleItem) => (
      !projectType
      || projectType.subType === '待识别'
      || ruleItem.subType === projectType.subType
      || ruleItem.majorType === '通用工程'
    ))
    .map((ruleItem) => ({
      rule: ruleItem,
      hitCount: ruleItem.keywords.filter((keyword) => text.includes(keyword)).length,
    }))
    .filter((entry) => entry.hitCount > 0)
    .sort((a, b) => b.hitCount - a.hitCount || b.rule.keywords.join('').length - a.rule.keywords.join('').length)[0]?.rule;
}

function deriveStrategy(item: CompareItemInput, projectType: { majorType: string; subType: string; basis: string }): {
  automaticLevel: StrategyLevel;
  projectMajorType: string;
  projectSubType: string;
  checklistStep: string;
  optimization: string;
  profitOpportunity: string;
  reviewStatus: string;
  reasonParts: string[];
} {
  const matchedRule = matchStrategyRule(item, projectType);
  const optimization = inferOptimization(item);
  const deviationLevel = normalizeDeviationLevel(item.deviationLevel);
  const reasonParts: string[] = [];

  if (matchedRule) {
    reasonParts.push(`匹配策略库：${projectType.majorType}/${projectType.subType}/${matchedRule.step}`);
    reasonParts.push(`总利润增量判断：${matchedRule.reason}，利润影响${matchedRule.profitImpact}`);
  }

  const text = `${item.category} ${item.name} ${item.feature || ''}`;
  const highRisk = containsAny(text, HIGH_RISK_KEYWORDS);
  const lowRisk = containsAny(text, LOW_RISK_KEYWORDS);
  let automaticLevel: StrategyLevel = matchedRule?.level ?? '平均偏低';
  let profitOpportunity = matchedRule
    ? `${matchedRule.direction}：${matchedRule.profitImpact}`
    : '未匹配明确利润点，按通用原则判断';
  const reviewStatus = projectType.subType === '待识别'
    ? '需人工复核项目类别'
    : (matchedRule ? '系统已匹配策略库' : '需人工复核清单步骤');

  if (!matchedRule) {
    if (deviationLevel.includes('明显偏低') || containsAny(text, ['压价']) || highRisk) {
      automaticLevel = highRisk ? '高' : '平均偏高';
      profitOpportunity = '存在压价或风险关键词，倾向保价';
    } else if (lowRisk || optimization === '优化多' || optimization === '优化较多') {
      automaticLevel = lowRisk ? '低' : '平均偏低';
      profitOpportunity = '工程量小或可优化，倾向配平让利';
    }
  }

  if (item.isScreeningItem) {
    reasonParts.push('该项是单价甄别项目：不直接加减等级，但步骤5必须做动态系数合规校验');
  }
  reasonParts.push(`工程量优化判断：${optimization}`);
  reasonParts.push(projectType.basis);
  if (!matchedRule) reasonParts.push(`未匹配明确工程类型/清单步骤，${profitOpportunity}`);

  return {
    automaticLevel,
    projectMajorType: projectType.majorType,
    projectSubType: projectType.subType,
    checklistStep: matchedRule?.step ?? '待人工确认',
    optimization,
    profitOpportunity,
    reviewStatus,
    reasonParts,
  };
}

function getDiscountRange(level: StrategyLevel, averageDiscountRate: number): [number, number] {
  const avg = Math.min(Math.max(averageDiscountRate, 0.01), 0.95);
  const low = Math.max(avg * 0.3, 0);
  const high = Math.min(avg * 1.7, 0.95);
  const midHigh = (low + avg) / 2;
  const midLow = (avg + high) / 2;
  const ranges: Record<StrategyLevel, [number, number]> = {
    '极高': [0, low],
    '高': [low, midHigh],
    '平均偏高': [midHigh, avg],
    // “平均”为旧数据兼容档，按“平均偏高 + 平均偏低”的合集处理。
    '平均': [midHigh, midLow],
    '平均偏低': [avg, midLow],
    '低': [midLow, high],
    '极低': [high, 0.95],
  };
  return ranges[level];
}

function discountToCoefficientRange(range: [number, number]): [number, number] {
  return [round4(1 - range[1]), round4(1 - range[0])];
}

function getDefaultSuggestion(level: StrategyLevel): string {
  const suggestions: Record<StrategyLevel, string> = {
    '极高': '建议重点保价，采用极高报价等级',
    '高': '建议保价，采用偏高报价',
    '平均偏高': '建议略高于平均水平报价',
    '平均': '建议按平均水平报价',
    '平均偏低': '建议略低于平均水平报价',
    '低': '建议偏低报价',
    '极低': '建议作为可优化项目低价报价',
  };
  return suggestions[level];
}

function makeOverrideKey(item: Pick<CompareItemInput, 'row' | 'category' | 'code'>): string {
  return `${item.category}::${item.row}::${item.code}`;
}

function containsAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      compareItems,
      averageDiscountRate = 0.3,
      strategyOverrides = [],
    } = body as {
      compareItems?: CompareItemInput[];
      averageDiscountRate?: number;
      strategyOverrides?: StrategyOverride[];
    };

    if (!compareItems?.length) {
      return NextResponse.json({ success: false, error: '请提供：compareItems（步骤3的对比结果）' }, { status: 400 });
    }

    const overrideMap = new Map(strategyOverrides.map((item) => [makeOverrideKey(item), item]));
    const projectType = inferProjectTypeForBatch(compareItems);

    const strategyItems = compareItems.map((item) => {
      const deviationRate = Number.isFinite(item.deviationRate) ? item.deviationRate : 0;
      const deviationLevel = normalizeDeviationLevel(item.deviationLevel);
      const derived = deriveStrategy(item, projectType);
      const override = overrideMap.get(makeOverrideKey(item));
      const strategyLevel = override?.strategyLevel ?? derived.automaticLevel;
      const discountRange = getDiscountRange(strategyLevel, averageDiscountRate);
      const coefficientRange = discountToCoefficientRange(discountRange);
      const manuallyAdjusted = Boolean(override?.strategyLevel || override?.suggestion !== undefined);
      const manualNote = manuallyAdjusted ? '人工判断已覆盖系统自动建议' : '系统自动建议，需人工复核';
      const reason = [
        ...derived.reasonParts,
        `步骤3偏差：${deviationLevel}（${(deviationRate * 100).toFixed(2)}%）`,
        `自动建议等级：${derived.automaticLevel}`,
        manualNote,
      ].join('；');

      return {
        row: item.row,
        category: item.category,
        code: item.code,
        name: item.name,
        feature: item.feature,
        unit: item.unit,
        quantity: item.quantity,
        maxUnitPrice: item.maxUnitPrice,
        maxTotalPrice: item.maxTotalPrice ?? item.maxUnitPrice * item.quantity,
        ourUnitPrice: item.ourUnitPrice,
        deviationRate,
        deviationLevel,
        isScreeningItem: Boolean(item.isScreeningItem),
        itemReviewPrice: item.itemReviewPrice ?? item.maxTotalPrice ?? item.maxUnitPrice * item.quantity,
        screeningRank: item.screeningRank,
        screeningBasis: item.screeningBasis || '沿用步骤3单价甄别结果',
        isAbnormalBidItem: Boolean(item.isAbnormalBidItem),
        quantityForecast: '基本一致/待人工预测',
        optimization: derived.optimization,
        projectMajorType: derived.projectMajorType,
        projectSubType: derived.projectSubType,
        checklistStep: derived.checklistStep,
        profitOpportunity: derived.profitOpportunity,
        reviewStatus: derived.reviewStatus,
        strategyLevel,
        discountRange,
        coefficientRange,
        suggestion: override?.suggestion ?? getDefaultSuggestion(strategyLevel),
        reason,
      };
    });

    const levelCounts = strategyItems.reduce<Record<string, number>>((counts, item) => {
      counts[item.strategyLevel] = (counts[item.strategyLevel] || 0) + 1;
      return counts;
    }, {});

    return NextResponse.json({
      success: true,
      strategyItems,
      stats: {
        totalItems: strategyItems.length,
        levelCounts,
        screeningRule: '按新版步骤4：系统先按总利润增量、单价甄别约束、工程量优化原则给出建议；AI/系统建议后由人工复核，人工修改结果作为最终等级',
        screeningItems: strategyItems.filter((item) => item.isScreeningItem).length,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
