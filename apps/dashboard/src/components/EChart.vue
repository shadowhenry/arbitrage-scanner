<script setup lang="ts">
import type { EChartsOption } from 'echarts';
import * as echarts from 'echarts';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{ option: EChartsOption; height?: string }>();
const root = ref<HTMLDivElement>();
let chart: echarts.ECharts | undefined;
let observer: ResizeObserver | undefined;

onMounted(() => {
  if (root.value === undefined) return;
  chart = echarts.init(root.value);
  chart.setOption(props.option);
  observer = new ResizeObserver(() => chart?.resize());
  observer.observe(root.value);
});
watch(() => props.option, (option) => chart?.setOption(option, { notMerge: true }), { deep: true });
onBeforeUnmount(() => { observer?.disconnect(); chart?.dispose(); });
</script>

<template><div ref="root" class="chart" :style="{ height: height ?? '300px' }" /></template>
