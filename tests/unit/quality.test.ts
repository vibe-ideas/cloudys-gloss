import { describe, expect, it } from 'vitest';
import { assess, corpus } from '../quality/corpus';
const find = (id: string) => corpus.cases.find((item) => item.id === id)!;
describe('翻译质量回归语料', () => {
  it.each(corpus.cases)('$id · $title：参考译文通过已声明的检查', (testCase) => {
    expect(assess(testCase, testCase.referenceZh)).toEqual({ errors: [], review: [], automaticPassed: true });
  });
  it('模型漏掉第二个语义块时拒绝把第一段成功当作整篇成功', () => {
    const testCase = find('T03');
    expect(assess(testCase, [testCase.referenceZh[0]!]).automaticPassed).toBe(false);
  });
  it('模型保留中文但改错价格或删除负温度符号时触发硬性失败', () => {
    const price = find('T05'); const temperature = find('T08');
    expect(assess(price, price.referenceZh.map((text) => text.replace('49.90', '499.00'))).automaticPassed).toBe(false);
    expect(assess(temperature, temperature.referenceZh.map((text) => text.replace('零下 ', ''))).automaticPassed).toBe(false);
  });
  it('模型把河岸译成银行时即使返回中文也触发硬性失败', () => {
    expect(assess(find('T09'), ['过桥后，我们坐在银行，看着鸭子游过。']).automaticPassed).toBe(false);
  });
  it('译文使用合理近义表达时不要求与参考译文逐字匹配', () => {
    expect(assess(find('T09'), ['我们过桥后在河边坐下，看鸭子从眼前游过去。']).errors).toEqual([]);
    expect(assess(find('T16'), ['开始使用', '保存更改', '重新尝试']).errors).toEqual([]);
    expect(assess(find('T14'), ['在 Firefox 中，删除 /tmp/cache-v2.json 前调用 AbortController 的 abort() 方法。该文件是缓存，而不是备份。']).errors).toEqual([]);
  });
  it('单块长文漏掉后半篇时提示复核，不把关键词规则称为语义评分', () => {
    const assessment = assess(find('T04'), [find('T03').referenceZh[0]!]);
    expect(assessment.automaticPassed).toBe(true);
    expect(assessment.review).toHaveLength(2);
  });
});
