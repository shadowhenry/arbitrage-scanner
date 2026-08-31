<script setup lang="ts">
import type { EChartsOption } from 'echarts';
import { computed } from 'vue';
import EChart from '../components/EChart.vue';
import OpportunityTable from '../components/OpportunityTable.vue';
import type { DashboardSnapshot, OpportunityRow } from '../types.js';

const props = defineProps<{ snapshot: DashboardSnapshot; opportunities: readonly OpportunityRow[] }>();
const emit = defineEmits<{ select: [row: OpportunityRow]; navigate: [page: string] }>();
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const edgeChart = computed<EChartsOption>(() => ({
  grid: { left: 32, right: 14, top: 24, bottom: 28 },
  tooltip: { trigger: 'axis', backgroundColor: '#101b2d', borderColor: '#223652', textStyle: { color: '#e9f1fb' } },
  xAxis: { type: 'category', data: props.opportunities.slice(0, 7).map((item) => item.asset), axisLine: { lineStyle: { color: '#263a55' } }, axisLabel: { color: '#7890ad' } },
  yAxis: { type: 'value', axisLabel: { color: '#7890ad', formatter: '{value} bps' }, splitLine: { lineStyle: { color: '#17263a' } } },
  series: [{ type: 'bar', barWidth: 18, data: props.opportunities.slice(0, 7).map((item) => ({
    value: item.netEdgeBps,
    itemStyle: { color: item.netEdgeBps > 20 ? '#3dd6a4' : '#438df5', borderRadius: [4, 4, 0, 0] },
  })) }],
}));

const cards = computed(() => [
  { label: 'Opportunities today', value: props.snapshot.metrics.opportunitiesToday.toLocaleString(), detail: '+12.4% vs yesterday', tone: 'blue' },
  { label: 'Simulated profit today', value: money.format(props.snapshot.metrics.simulatedProfitToday), detail: 'Read-only simulation', tone: 'green' },
  { label: 'Best opportunity', value: props.snapshot.metrics.bestOpportunity, detail: 'Highest net edge', tone: 'violet' },
  { label: 'Median net edge', value: `${props.snapshot.metrics.medianNetEdgeBps.toFixed(1)} bps`, detail: 'Across active signals', tone: 'cyan' },
  { label: 'Capital utilization', value: `${(props.snapshot.metrics.capitalUtilization * 100).toFixed(1)}%`, detail: 'Simulated allocation', tone: 'amber' },
]);
</script>

<template>
  <section>
    <div class="page-heading"><div><p class="eyebrow">Research command center</p><h2>Overview</h2><p>Executable, market-neutral opportunities across connected venues.</p></div><el-button type="primary" plain @click="emit('navigate', 'opportunities')">View all opportunities</el-button></div>
    <div class="metric-grid">
      <article v-for="card in cards" :key="card.label" class="metric-card" :class="`tone-${card.tone}`">
        <div class="metric-icon">●</div><span>{{ card.label }}</span><strong>{{ card.value }}</strong><small>{{ card.detail }}</small>
      </article>
    </div>
    <div class="overview-grid">
      <article class="panel chart-panel"><div class="panel-title"><div><h3>Net edge leaders</h3><p>Current executable opportunity set</p></div><span class="live-label"><i /> LIVE</span></div><EChart :option="edgeChart" height="260px" /></article>
      <article class="panel allocation-panel"><div class="panel-title"><div><h3>Capital allocation</h3><p>Simulation utilization</p></div></div><div class="ring" :style="{ '--value': `${snapshot.metrics.capitalUtilization * 360}deg` }"><div><strong>{{ (snapshot.metrics.capitalUtilization * 100).toFixed(1) }}%</strong><span>utilized</span></div></div><div class="allocation-row"><span><i class="legend used" /> Deployed</span><strong>{{ money.format(68420) }}</strong></div><div class="allocation-row"><span><i class="legend free" /> Available</span><strong>{{ money.format(31580) }}</strong></div></article>
    </div>
    <article class="panel table-panel"><div class="panel-title"><div><h3>Live opportunities</h3><p>Ranked by expected profit, then return on capital</p></div><span class="row-count">{{ opportunities.length }} active</span></div><OpportunityTable :rows="opportunities" :max-rows="8" @select="emit('select', $event)" /></article>
  </section>
</template>
