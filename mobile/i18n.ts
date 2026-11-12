import {inject,provide,type InjectionKey} from 'vue'
import {createI18n,useI18n as useGlobalI18n,type Composer} from 'vue-i18n'
import {zh,en} from './messages'
import zhPatrol from '../locales/lang/zh.json'
import enPatrol from '../locales/lang/en.json'
const key:InjectionKey<Composer>=Symbol('patrol-i18n')
export function providePatrolI18n(){
 const i18n=createI18n({legacy:false,locale:'zh',fallbackLocale:'en',messages:{zh:{Mobile:zh,Patrol:zhPatrol.Patrol},en:{Mobile:en,Patrol:enPatrol.Patrol}}})
 provide(key,i18n.global as unknown as Composer)
}
export function useI18n(){return inject(key,null)||useGlobalI18n()}
