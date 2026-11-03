"use client";

import { useMemo, useState } from "react";
import { Activity, ChartNoAxesCombined, Info } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { nutritionHistory, shareExplanation, type NutritionHistoryDay, type NutritionRange } from "@/lib/nutrition-history";
import type { Entry, Nutrients } from "@/lib/domain";
import styles from "./nutrition-trends.module.css";

const nutrients = [
  {key:"protein",label:"Protein",color:"#735191",dash:undefined},
  {key:"carbs",label:"Carbs",color:"#af8540",dash:undefined},
  {key:"fat",label:"Fat",color:"#a16e91",dash:"7 3"},
  {key:"fiber",label:"Fiber",color:"#527fa5",dash:"2 3"},
] as const;
const shares = [
  {key:"etlPercent",label:"ETL",color:"#735191",dash:undefined},
  {key:"flexPercent",label:"Flex",color:"#af8540",dash:"7 3"},
  {key:"runFuelPercent",label:"Running fuel",color:"#527fa5",dash:"2 3"},
] as const;
const shortDate = (date:string) => new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",timeZone:"UTC"}).format(new Date(`${date}T12:00:00Z`));
const fullDate = (date:string) => new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"}).format(new Date(`${date}T12:00:00Z`));
const value = (amount:number|null, unit:string) => amount == null ? "Unknown" : `${amount.toLocaleString("en-US",{maximumFractionDigits:1})}${unit === "%" ? "" : " "}${unit}`;
const sourceLabel = (day:NutritionHistoryDay) => day.source === "historical-summary" ? "Historical estimate · day coverage unknown"
  : day.source === "unknown" ? "No saved intake" : day.foodComplete ? "Saved meals · logging marked complete" : "Saved meals · day coverage incomplete";

function ChartTooltip({active,payload,kind}:{active?:boolean;payload?:readonly {payload?:NutritionHistoryDay}[];kind:"energy"|"nutrients"|"shares"}) {
  const day=payload?.[0]?.payload;
  if(!active||!day)return null;
  const fields=kind==="energy"?[{key:"calories",label:"Energy",color:"#735191"}]:kind==="shares"?shares:nutrients;
  return <div className={styles.tooltip}>
    <strong>{fullDate(day.date)}</strong><small>{sourceLabel(day)}</small>
    <dl>{fields.map(field=>{
      const key=field.key as keyof NutritionHistoryDay, amount=day[key] as number|null;
      const coverage=kind!=="shares"?day.coverage[field.key as keyof Nutrients]:null;
      return <div key={field.key}><dt><i style={{background:field.color}}/>{field.label}</dt><dd>{value(amount,kind==="shares"?"%":kind==="energy"?"kcal":"g")}
        {day.source==="meals"&&coverage&&coverage.known>0&&coverage.known<coverage.total&&<small>{coverage.known}/{coverage.total} meals known</small>}</dd></div>;
    })}</dl>
    {kind==="shares"&&<p>{shareExplanation[day.shareStatus]}</p>}
  </div>;
}

export function NutritionTrends({records,selectedDate,onOpenDate}:{records:Entry[];selectedDate:string;onOpenDate:(date:string)=>void}) {
  const [range,setRange]=useState<NutritionRange>("all");
  const [visible,setVisible]=useState<string[]>(nutrients.map(n=>n.key));
  const through=useMemo(()=>range==='all'?records.filter(e=>!e.deleted&&["meal","dailySummary"].includes(e.kind)&&e.localDate)
    .reduce((last,e)=>e.localDate!>last?e.localDate!:last,selectedDate):selectedDate,[records,selectedDate,range]);
  const days=useMemo(()=>nutritionHistory(records,through,range),[records,through,range]);
  const recorded=days.filter(day=>day.source!=="unknown").length;
  const classified=days.filter(day=>day.shareStatus==="known").length;
  const estimates=days.filter(day=>day.source==="historical-summary").length;
  const energyDays=days.filter(day=>day.calories!==null).length;
  const from=days[0]?.date??through;
  const axes=<><CartesianGrid stroke="#e8e1eb" strokeDasharray="3 4" vertical={false}/>
    <XAxis dataKey="date" tickFormatter={shortDate} tick={{fill:"#776b7d",fontSize:11}} axisLine={false} tickLine={false} minTickGap={26} interval="preserveStartEnd" tickMargin={10}/></>;
  return <section className={`card ${styles.root}`} aria-labelledby="nutrition-trends-heading">
    <header className={styles.header}>
      <div><p className={styles.eyebrow}><Activity size={14}/> YOUR SAVED HISTORY</p><h2 id="nutrition-trends-heading">Daily nutrition trends</h2>
        <p className={styles.subtitle}>Energy, nutrients, and how your logged calories break down.</p></div>
      <div className={styles.ranges} role="group" aria-label="Nutrition chart date range">{([7,14,28,"all"] as const).map(option=>
        <button type="button" key={option} aria-pressed={range===option} onClick={()=>setRange(option)}>{option==="all"?"All history":`${option} days`}</button>)}</div>
    </header>
    <div className={styles.meta}><span>{fullDate(from)} – {fullDate(through)}</span><span>{recorded} of {days.length} days have records{estimates>0?` · ${estimates} historical estimates`:""}</span></div>
    {!recorded?<div className={styles.empty}><ChartNoAxesCombined size={28}/><h3>No saved intake in this range</h3><p>Log food or import your history to see daily trends. Dates without records stay unknown.</p></div>:<>
      <div className={styles.grid}>
        <div className={styles.panel}>
          <div className={styles.panelHeader}><div><h3>Daily energy</h3><p>Kilocalories · saved intake</p></div><span>{energyDays} {energyDays===1?'day':'days'} with values</span></div>
          <div className={styles.legend}><span><i style={{background:"#735191"}}/>Calories</span></div>
          <div className={styles.chart} aria-label="Daily calories chart, measured in kilocalories">
            <ResponsiveContainer width="100%" height="100%" initialDimension={{width:320,height:240}}>
              <LineChart accessibilityLayer data={days} margin={{top:8,right:12,bottom:8,left:0}}>
                {axes}<YAxis width={43} domain={[0,"auto"]} tick={{fill:"#776b7d",fontSize:11}} axisLine={false} tickLine={false} tickFormatter={n=>Number(n).toLocaleString("en-US")}/>
                <Tooltip content={<ChartTooltip kind="energy"/>} filterNull={false}/>
                <Line type="linear" dataKey="calories" name="Calories" stroke="#735191" strokeWidth={2.5} connectNulls={false} dot={{r:days.length<=31?2.5:1.5,fill:"#fff",strokeWidth:1.5}} activeDot={{r:5,fill:"#735191",stroke:"#fff",strokeWidth:2}} isAnimationActive={false}/>
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className={styles.panel}>
          <div className={styles.panelHeader}><div><h3>Daily nutrients</h3><p>Grams · toggle a series below</p></div></div>
          <div className={styles.legend} role="group" aria-label="Visible nutrient series">{nutrients.map(n=><button type="button" key={n.key} aria-pressed={visible.includes(n.key)}
            onClick={()=>setVisible(current=>current.includes(n.key)?current.filter(key=>key!==n.key):[...current,n.key])}><i style={{background:n.color}}/>{n.label}</button>)}</div>
          <div className={styles.chart} aria-label="Daily protein, carbohydrate, fat, and fiber chart, measured in grams">
            {visible.length?<ResponsiveContainer width="100%" height="100%" initialDimension={{width:320,height:240}}>
              <LineChart accessibilityLayer data={days} margin={{top:8,right:12,bottom:8,left:0}}>
                {axes}<YAxis width={36} domain={[0,"auto"]} tick={{fill:"#776b7d",fontSize:11}} axisLine={false} tickLine={false}/>
                <Tooltip content={<ChartTooltip kind="nutrients"/>} filterNull={false}/>
                {nutrients.filter(n=>visible.includes(n.key)).map(n=><Line key={n.key} type="linear" dataKey={n.key} name={n.label} stroke={n.color} strokeDasharray={n.dash} strokeWidth={2} connectNulls={false} dot={{r:days.length<=14?2:1.5,fill:"#fff"}} activeDot={{r:4}} isAnimationActive={false}/>)}
              </LineChart>
            </ResponsiveContainer>:<p className={styles.noSeries}>Choose a nutrient above to show its trend.</p>}
          </div>
        </div>
      </div>
      <div className={`${styles.panel} ${styles.sharePanel}`}>
        <div className={styles.panelHeader}><div><h3>Daily energy shares</h3><p>Percent of recorded calories · ETL, flex, and running fuel</p></div><span>{classified} of {days.length} dates classified</span></div>
        <div className={styles.legend}>{shares.map(s=><span key={s.key}><i style={{background:s.color}}/>{s.label}</span>)}</div>
        {classified?<div className={styles.shareChart} aria-label="Daily ETL, flex, and running-fuel percentages of recorded energy">
          <ResponsiveContainer width="100%" height="100%" initialDimension={{width:680,height:230}}>
            <LineChart accessibilityLayer data={days} margin={{top:8,right:12,bottom:8,left:0}}>
              {axes}<YAxis width={42} domain={[0,100]} ticks={[0,25,50,75,100]} tickFormatter={n=>`${n}%`} tick={{fill:"#776b7d",fontSize:11}} axisLine={false} tickLine={false}/>
              <Tooltip content={<ChartTooltip kind="shares"/>} filterNull={false}/>
              {shares.map(s=><Line key={s.key} type="linear" dataKey={s.key} name={s.label} stroke={s.color} strokeDasharray={s.dash} strokeWidth={2} connectNulls={false} dot={{r:days.length<=31?2.5:1.5,fill:"#fff",strokeWidth:1.5}} activeDot={{r:4}} isAnimationActive={false}/>)}
            </LineChart>
          </ResponsiveContainer>
        </div>:<p className={styles.classificationEmpty}>Energy shares are not available for this range. Each saved record needs total calories and explicit, separate flex and running-fuel calories.</p>}
        <p className={styles.shareNote}>ETL = total calories − flex − running fuel. Each share uses the same total; running fuel is counted once. ETL here is the remaining energy under this convention, not a separate food-quality assessment.</p>
      </div>
    </>}
    <details className={styles.values}><summary>About partial logs & missing values</summary><div className={styles.note}><Info size={16}/><p>These are recorded amounts, not assumed full-day intake. Known partial sums keep their coverage in the tooltip. Missing values break the lines; shares stay blank if any classification is missing or flex plus running fuel exceeds a record’s calories. Saved meals replace the whole historical summary for the same date.</p></div></details>
    <details className={styles.values}>
      <summary>Daily history · {recorded} recorded {recorded===1?'day':'days'}</summary>
      <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Daily nutrition history"><table>
        <thead><tr><th scope="col">Date</th><th scope="col">kcal</th>{nutrients.map(n=><th scope="col" key={n.key}>{n.label} · g</th>)}{shares.map(s=><th scope="col" key={s.key}>{s.label} · %</th>)}<th scope="col">Coverage</th></tr></thead>
        <tbody>{[...days].reverse().map(day=><tr key={day.date}><th scope="row"><button type="button" onClick={()=>onOpenDate(day.date)}>{fullDate(day.date)}</button></th>
          {(["calories","protein","carbs","fat","fiber","etlPercent","flexPercent","runFuelPercent"] as const).map(key=><td key={key}>{day[key]==null?"—":day[key].toLocaleString("en-US",{maximumFractionDigits:1})}</td>)}
          <td>{sourceLabel(day)}{day.source==="meals"&&Object.values(day.coverage).some(c=>c.known<c.total)?" · some values missing":""}</td></tr>)}</tbody>
      </table></div>
    </details>
  </section>;
}
