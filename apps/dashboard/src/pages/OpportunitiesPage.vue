<script setup lang="ts">
import { computed, ref } from 'vue';
import OpportunityTable from '../components/OpportunityTable.vue';
import type { OpportunityRow } from '../types.js';
const props = defineProps<{ rows: readonly OpportunityRow[] }>();
const emit = defineEmits<{ select: [row: OpportunityRow] }>();
const search = ref(''); const strategy = ref('All'); const minEdge = ref(0);
const filtered = computed(() => props.rows.filter((row) => (strategy.value === 'All' || row.strategy === strategy.value) && row.netEdgeBps >= minEdge.value && `${row.asset} ${row.buyVenue} ${row.sellVenue}`.toLowerCase().includes(search.value.toLowerCase())));
</script>
<template><section><div class="page-heading"><div><p class="eyebrow">Graph scanner</p><h2>Arbitrage Opportunities</h2><p>Executable two-leg combinations across all supported strategies.</p></div></div><article class="panel filters"><el-input v-model="search" placeholder="Search asset or venue" clearable /><el-select v-model="strategy"><el-option v-for="item in ['All','S1','S2','S3','S4','S5','S6']" :key="item" :label="item === 'All' ? 'All strategies' : item" :value="item" /></el-select><div class="edge-filter"><span>Minimum edge</span><el-input-number v-model="minEdge" :min="0" :max="100" :step="1" /><small>bps</small></div><span class="filter-result">{{ filtered.length }} results</span></article><article class="panel table-panel"><OpportunityTable :rows="filtered" @select="emit('select', $event)" /></article></section></template>
