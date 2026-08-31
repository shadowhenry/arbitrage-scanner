<script setup lang="ts">
import type { OpportunityRow } from '../types.js';

defineProps<{ rows: readonly OpportunityRow[]; maxRows?: number }>();
const emit = defineEmits<{ select: [row: OpportunityRow] }>();
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const profit = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const time = (value: string) => new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value));
</script>

<template>
  <el-table :data="maxRows ? rows.slice(0, maxRows) : rows" class="opportunity-table" @row-click="emit('select', $event)">
    <el-table-column label="Asset" min-width="90" fixed>
      <template #default="scope"><span class="asset-cell"><span class="asset-dot" />{{ scope.row.asset }}</span></template>
    </el-table-column>
    <el-table-column label="Strategy" width="92">
      <template #default="scope"><el-tag size="small" effect="plain">{{ scope.row.strategy }}</el-tag></template>
    </el-table-column>
    <el-table-column prop="buyVenue" label="Buy Venue" min-width="135" />
    <el-table-column prop="sellVenue" label="Sell Venue" min-width="135" />
    <el-table-column label="Gross Edge" width="112" align="right">
      <template #default="scope">{{ scope.row.grossEdgeBps.toFixed(1) }} bps</template>
    </el-table-column>
    <el-table-column label="Net Edge" width="108" align="right">
      <template #default="scope"><span class="positive">{{ scope.row.netEdgeBps.toFixed(1) }} bps</span></template>
    </el-table-column>
    <el-table-column label="Capacity" width="116" align="right">
      <template #default="scope">{{ money.format(scope.row.capacityUsd) }}</template>
    </el-table-column>
    <el-table-column label="Expected Profit" width="142" align="right">
      <template #default="scope"><strong class="positive">{{ profit.format(scope.row.expectedProfitUsd) }}</strong></template>
    </el-table-column>
    <el-table-column prop="duration" label="Duration" width="94" />
    <el-table-column label="Detected At" width="116"><template #default="scope">{{ time(scope.row.detectedAt) }}</template></el-table-column>
  </el-table>
</template>
