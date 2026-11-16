<script setup lang="ts">
import {inject,ref as popupRef} from 'vue'
const popupTarget=inject('business-popup-target',popupRef<HTMLElement|string>('body'))
import { Image, showImagePreview } from 'vant'
const props = defineProps<{ src: string; alt?: string; width?: number }>()
</script>
<template><Image :src="src" :alt="alt" :width="width || 160" fit="contain" radius="8" @click="showImagePreview({ teleport: popupTarget, images: [props.src], closeable: true })" /></template>
