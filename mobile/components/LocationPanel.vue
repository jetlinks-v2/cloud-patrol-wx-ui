<script setup lang="ts">
import { computed } from 'vue'
import { Button, Icon, Tag } from 'vant'
import { useI18n } from '../i18n'
import { distanceTo, locationStatus } from '../location'
import type { LocationEvidence, LocationReference } from '../../api/types'
const props = defineProps<{ reference: LocationReference; evidence?: LocationEvidence | null; locating?: boolean; locked?: boolean }>()
const emit = defineEmits<{ refresh: [] }>()
const { t } = useI18n()
const distance = computed(() => distanceTo(props.reference, props.evidence))
const status = computed(() => locationStatus(props.reference, props.evidence))
const marker = computed(() => 100 + Math.min(78, (distance.value ?? 0) / props.reference.rangeMeters * 58))
</script>
<template>
  <section class="panel location-panel">
    <div class="location-heading"><h3><Icon name="location-o" />{{ t('Mobile.geo.title') }}</h3><Tag :type="status === 'inside' ? 'success' : status === 'unknown' ? 'default' : 'warning'">{{ t(`Mobile.geo.${status}`) }}</Tag></div>
    <div class="location-content">
      <svg class="location-radar" viewBox="0 0 200 150" role="img" :aria-label="t('Mobile.geo.rangeLabel', { value: reference.rangeMeters })">
        <path d="M0 45H200M0 105H200M45 0V150M155 0V150" stroke="#e5edf3" stroke-width="10" fill="none" />
        <circle cx="100" cy="75" r="58" fill="#e5f2ff" stroke="#83b6f6" stroke-dasharray="4 4" />
        <circle cx="100" cy="75" r="5" fill="#2979ff" /><circle v-if="evidence" :cx="marker" cy="75" r="7" :fill="status === 'outside' ? '#ee8d32' : '#20a077'" stroke="white" stroke-width="3" />
      </svg>
      <div class="location-metrics"><p>{{ t('Mobile.geo.rangeLabel', { value: reference.rangeMeters }) }}</p><strong>{{ distance == null ? '—' : `${Math.round(distance)} ${t('Patrol.geo.meters')}` }}</strong><span>{{ t('Patrol.geo.distance') }}</span><small v-if="evidence">{{ t('Patrol.geo.accuracy') }} ±{{ Math.round(evidence.accuracy) }} {{ t('Patrol.geo.meters') }}</small></div>
    </div>
    <p class="location-address">{{ evidence?.address || reference.address || t('Mobile.geo.pointNearby') }}</p>
    <p v-if="evidence" class="location-coordinates">{{ evidence.longitude.toFixed(6) }}, {{ evidence.latitude.toFixed(6) }}</p>
    <div class="location-footer"><span>{{ t('Mobile.geo.advisory') }}</span><Button size="small" plain type="primary" :disabled="locked" :loading="locating" @click="emit('refresh')">{{ t('Mobile.geo.refresh') }}</Button></div>
  </section>
</template>
<style scoped>
.location-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}.location-heading h3{display:flex;align-items:center;gap:6px;margin:0}.location-content{display:flex;align-items:center;gap:16px;margin:14px 0}.location-radar{width:48%;max-width:190px;border-radius:14px;background:#f5f8fb}.location-metrics{display:flex;flex-direction:column;gap:5px}.location-metrics p{margin:0;color:#526477;font-size:13px}.location-metrics strong{font-size:28px;color:#1e3650}.location-metrics span,.location-metrics small{font-size:12px;color:#7a8b9b}.location-address{margin:0;color:#455a70;font-size:13px}.location-coordinates{font-size:12px;color:#8494a6;margin:5px 0 0}.location-footer{border-top:1px solid #edf1f6;margin-top:14px;padding-top:12px;display:flex;align-items:center;justify-content:space-between;gap:12px}.location-footer span{font-size:12px;color:#8494a6;line-height:1.5}.location-footer .van-button{flex-shrink:0}
</style>
