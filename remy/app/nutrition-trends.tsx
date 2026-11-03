"use client";

import { useMemo, useState } from "react";
import { Activity, ChartNoAxesCombined, Info } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { nutritionHistory, shareExplanation, type NutritionHistoryDay } from "@/lib/nutrition-history";
import { dailyEnergyHistory, nutritionPeriodSummary, type SummaryRange } from "@/lib/thirty-day-summary";
import { weightHistory } from "@/lib/weight-history";
import { localDate, profileOf, type Entry, type Nutrients } from "@/lib/domain";
import styles from "./nutrition-trends.module.css";

const nutrients = [
  {key:"protein",label:"Protein",color:"#735191",dash:undefined},
  {key:"carbs",label:"Carbs",color:"#af8540",dash:undefined},
  {key:"fat",label:"Fat",color:"#a16e91",dash:"7 3"},
  {key:"fiber",label:"Fiber",color:"#527fa5",dash:"2 3"},
] as const;
const shares = [
  {key:"etlPercent",label:"ETL balance",color:"#735191",dash:undefined},
  {key:"flexPercent",label:"Flex",color:"#af8540",dash:"7 3"},
  {key:"runFuelPercent",label:"Running fuel",color:"#527fa5",dash:"2 3"},
] as const;
const energySeries = [
  {key:'netKcal',label:'Eaten − burned',color:'#4f3264',axis:'calories',unit:'kcal',dash:undefined},
  {key:'calories',label:'Calories eaten',color:'#9676ac',axis:'calories',unit:'kcal',dash:undefined},
  {key:'burnKcal',label:'Estimated burn',color:'#af8540',axis:'calories',unit:'kcal',dash:'6 3'},
  {key:'weightLb',label:'Weight · lb',color:'#527fa5',axis:'weight',unit:'lb',dash:undefined},
] as const;
type EnergySeriesKey=typeof energySeries[number]['key'];
const shortDate = (date:string) => new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",timeZone:"UTC"}).format(new Date(`${date}T12:00:00Z`));
const fullDate = (date:string) => new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"}).format(new Date(`${date}T12:00:00Z`));
const value = (amount:number|null, unit:string) => amount == null ? "Unknown" : `${amount.toLocaleString("en-US",{maximumFractionDigits:1})}${unit === "%" ? "" : " "}${unit}`;
const sourceLabel = (day:NutritionHistoryDay) => day.source === "historical-summary" ? "Historical estimate · day coverage unknown"
  : day.source === "unknown" ? "No saved intake" : day.foodComplete ? "Saved meals · logging marked complete" : "Saved meals · day coverage incomplete";
const shareSourceLabel=(day:NutritionHistoryDay)=>day.shareBasis==='daily-conversation-estimate'?'Reviewed daily estimate from REMY':day.shareBasis==='historical-conversation-estimate'?'Earlier REMY estimate · original flex convention':day.shareBasis==='meal-estimates'?'Classified meal estimates':'Classification unavailable';

function AverageStat({label,amount,unit,coverage,tone,signed=false}:{label:string;amount:number|null;unit:string;coverage:string;tone?:"tan"|"purple";signed?:boolean}) {
  const formatted=amount===null?'—':`${signed&&amount>0?'+':''}${amount.toLocaleString('en-US',{maximumFractionDigits:unit==='kcal/day'?0:1})}`;
  return <div className={`${styles.averageStat}${tone?` ${styles[tone]}`:''}`}>
    <dt>{label}</dt><dd>{formatted}<small>{unit}</small></dd><p>{coverage}</p>
  </div>;
}

type EnergyPoint={date:string;calories:number|null;burnKcal:number|null;netKcal:number|null;weightLb:number|null;burnStatus:string;foodSource:string;weightSource?:string};
function EnergyTooltip({active,payload,visible}:{active?:boolean;payload?:readonly {payload?:EnergyPoint}[];visible:EnergySeriesKey[]}) {
  const day=payload?.[0]?.payload;if(!active||!day)return null;
  return <div className={styles.tooltip}><strong>{fullDate(day.date)}</strong><dl>
    {energySeries.filter(series=>visible.includes(series.key)).map(series=><div key={series.key}><dt><i style={{background:series.color}}/>{series.label}</dt><dd>{series.key==='netKcal'&&day.netKcal!==null&&day.netKcal>0?'+':''}{value(day[series.key],series.unit)}</dd></div>)}
  </dl>{(visible.includes('calories')||visible.includes('netKcal'))&&<small>{day.foodSource}</small>}{(visible.includes('burnKcal')||visible.includes('netKcal'))&&<small>{day.burnStatus==='complete'?'WHOOP cycle estimate allocated by elapsed time':day.burnStatus==='overlap'?'Overlapping WHOOP periods; burn is unknown':day.burnStatus==='partial'?'WHOOP covers only part of this date':'No completed WHOOP cycle coverage'}</small>}{visible.includes('weightLb')&&day.weightSource&&<small>{day.weightSource}</small>}</div>;
}

function ChartTooltip({active,payload,kind}:{active?:boolean;payload?:readonly {payload?:NutritionHistoryDay}[];kind:"energy"|"nutrients"|"shares"}) {
  const day=payload?.[0]?.payload;
  if(!active||!day)return null;
  const fields=kind==="energy"?[{key:"calories",label:"Energy",color:"#735191"}]:kind==="shares"?shares:nutrients;
  return <div className={styles.tooltip}>
    <strong>{fullDate(day.date)}</strong><small>{kind==='shares'?shareSourceLabel(day):sourceLabel(day)}</small>
    <dl>{fields.map(field=>{
      const key=field.key as keyof NutritionHistoryDay, amount=day[key] as number|null;
      const coverage=kind!=="shares"?day.coverage[field.key as keyof Nutrients]:null;
      return <div key={field.key}><dt><i style={{background:field.color}}/>{field.label}</dt><dd>{field.key==='etlPercent'&&day.etlPercentRange?`${value(day.etlPercentRange[0],'%')}–${value(day.etlPercentRange[1],'%')}`:value(amount,kind==="shares"?"%":kind==="energy"?"kcal":"g")}
        {field.key==='etlPercent'&&day.etlPercentRange&&<small>{value(day.etlPercent,'%')} midpoint plotted</small>}
        {day.source==="meals"&&coverage&&coverage.known>0&&coverage.known<coverage.total&&<small>{coverage.known}/{coverage.total} meals known</small>}</dd></div>;
    })}</dl>
    {kind==="shares"&&<><p>{day.shareBasis==='historical-conversation-estimate'?'This earlier source estimate retains its original flex convention.':shareExplanation[day.shareStatus]}</p>{day.shareNotes&&<p>{day.shareNotes}</p>}</>}
  </div>;
}

export function NutritionTrends({records,selectedDate,onOpenDate}:{records:Entry[];selectedDate:string;onOpenDate:(date:string)=>void}) {
  const [range,setRange]=useState<SummaryRange>(30);
  const [visible,setVisible]=useState<string[]>(nutrients.map(n=>n.key));
  const [energyVisible,setEnergyVisible]=useState<EnergySeriesKey[]>(['netKcal']);
  const through=useMemo(()=>records.filter(e=>!e.deleted&&["meal","dailySummary"].includes(e.kind)&&e.localDate)
    .reduce((last,e)=>e.localDate!>last?e.localDate!:last,"")||selectedDate,[records,selectedDate]);
  const days=useMemo(()=>nutritionHistory(records,through,"all"),[records,through]);
  const averages=useMemo(()=>nutritionPeriodSummary(records,selectedDate,range),[records,selectedDate,range]);
  const weights=useMemo(()=>weightHistory(records),[records]);
  const energyDays=useMemo(()=>{
    const zone=profileOf(records).timezone,today=localDate(new Date(),zone);
    const cycleDates=records.filter(entry=>!entry.deleted&&entry.kind==='recovery').flatMap(entry=>[entry.data.start,entry.data.end]
      .filter((instant):instant is string=>typeof instant==='string'&&Number.isFinite(Date.parse(instant))).map(instant=>localDate(instant,zone)));
    const dates=[...days.filter(day=>day.source!=='unknown').map(day=>day.date),...weights.map(point=>point.date),...cycleDates].filter(date=>date<=today).sort();
    const start=dates[0]??through,end=dates.at(-1)??through;
    const foodByDate=new Map(days.map(day=>[day.date,day])),weightByDate=new Map(weights.map(point=>[point.date,point]));
    return dailyEnergyHistory(records,start,end).map(day=>{
      const food=foodByDate.get(day.date),weight=weightByDate.get(day.date);
      const calories=food?.calories??null;
      const netKcal=calories!==null&&Number.isFinite(calories)&&calories>=0&&day.burnStatus==='complete'&&day.burnKcal!==null&&Number.isFinite(day.burnKcal)?calories-day.burnKcal:null;
      return {...day,calories,netKcal,weightLb:weight?.weightLb??null,foodSource:food?sourceLabel(food):'No saved food for this date',weightSource:weight?.sourceLabel} satisfies EnergyPoint;
    });
  },[records,days,weights,through]);
  const calorieSeriesVisible=energyVisible.some(key=>key!=='weightLb');
  const weightVisible=energyVisible.includes('weightLb');
  const selectedEnergyHasData=energyDays.some(day=>energyVisible.some(key=>day[key]!==null));
  const calorieDomain=useMemo<[number,number]>(()=>{
    const values=energyDays.flatMap(day=>energyVisible.filter(key=>key!=='weightLb').map(key=>day[key]).filter((amount):amount is number=>amount!==null&&Number.isFinite(amount)));
    const lower=Math.min(0,...values),upper=Math.max(0,...values);
    if(lower===upper)return[-1,1];
    const step=10**Math.floor(Math.log10((upper-lower)/5));
    return[lower<0?Math.floor(lower/step)*step:0,upper>0?Math.ceil(upper/step)*step:0];
  },[energyDays,energyVisible]);
  const recorded=days.filter(day=>day.source!=="unknown").length;
  const classified=days.filter(day=>day.etlPercent!==null).length;
  const estimates=days.filter(day=>day.source==="historical-summary").length;
  const weightDays=energyDays.filter(day=>day.weightLb!==null).length;
  const hasEnergy=energyDays.some(day=>day.calories!==null||day.burnKcal!==null||day.weightLb!==null);
  const rangeEstimates=averages.days.filter(day=>day.etlPercentRange!==null).length;
  const legacyEstimates=averages.days.filter(day=>day.shareBasis==='historical-conversation-estimate').length;
  const from=days[0]?.date??through;
  const axes=<><CartesianGrid stroke="#e8e1eb" strokeDasharray="3 4" vertical={false}/>
    <XAxis dataKey="date" tickFormatter={shortDate} tick={{fill:"#776b7d",fontSize:11}} axisLine={false} tickLine={false} minTickGap={26} interval="preserveStartEnd" tickMargin={10}/></>;
  return <section className={`card ${styles.root}`} aria-labelledby="nutrition-trends-heading">
    <header className={styles.header}>
      <div><p className={styles.eyebrow}><Activity size={14}/> YOUR SAVED HISTORY</p><h2 id="nutrition-trends-heading">Your daily averages</h2>
        <p className={styles.subtitle}>Food, estimated burn, and your Eat to Live balance.</p></div>
      <div className={styles.ranges} role="group" aria-label="Headline average lookback">{([7,14,30,"all"] as const).map(option=>
        <button type="button" key={option} aria-pressed={range===option} onClick={()=>setRange(option)}>{option==="all"?"All history":`${option} days`}</button>)}</div>
    </header>
    <div className={styles.averageMeta}><span>{fullDate(averages.from)} – {fullDate(averages.through)}</span><span>{averages.dayCount} completed {averages.dayCount===1?'day':'days'} · selection changes averages only</span></div>
    <dl className={styles.averageGrid} aria-label="Energy and Eat to Live averages">
      <AverageStat label="Calories eaten" amount={averages.nutrients.calories.average} unit="kcal/day" coverage={`${averages.nutrients.calories.knownDays}/${averages.dayCount} days with logged calories`} tone="purple"/>
      <AverageStat label="Estimated calories burned" amount={averages.burn.average} unit="kcal/day" coverage={`${averages.burn.knownDays}/${averages.dayCount} days covered by WHOOP`} tone="tan"/>
      <AverageStat label="Eaten − burned" amount={averages.comparison.differenceAverage} unit="kcal/day" signed coverage={`${averages.comparison.pairedDays}/${averages.dayCount} matched days${averages.comparison.pairedDays?` · ${Math.round(averages.comparison.intakeAverage!).toLocaleString()} − ${Math.round(averages.comparison.burnAverage!).toLocaleString()}`:' · no comparable daily values'}`}/>
      <AverageStat label="ETL balance" amount={averages.etl.percent} unit="%" coverage={`${averages.etl.classifiedDays}/${averages.dayCount} days classified${rangeEstimates?` · ${rangeEstimates} source ranges`:''}`} tone="purple"/>
    </dl>
    <dl className={`${styles.averageGrid} ${styles.nutrientAverages}`} aria-label="Daily nutrient averages">
      {nutrients.map(n=><AverageStat key={n.key} label={n.label} amount={averages.nutrients[n.key].average} unit="g/day" coverage={`${averages.nutrients[n.key].knownDays}/${averages.dayCount} days with values${averages.nutrients[n.key].partialDays?` · ${averages.nutrients[n.key].partialDays} partial`:''}`}/>)}
    </dl>
    <details className={`${styles.values} ${styles.averageDetails}`}><summary>How these averages are calculated</summary><div className={styles.methodNotes}>
      <p>Intake averages use days with recorded values; missing days are not zero. {averages.nutrients.calories.partialDays>0?`${averages.nutrients.calories.partialDays} calorie totals have missing meal estimates. `:''}A logged day can still be incomplete.</p>
      <p>{averages.method.burn}</p><p>{averages.method.comparison} {averages.comparison.pairedDays>0?`For those matched days: ${value(averages.comparison.intakeAverage,'kcal/day')} eaten and ${value(averages.comparison.burnAverage,'kcal/day')} estimated burned.`:''}</p>
      <p>{averages.method.etl} {averages.etl.percent===null?'No complete ETL classification is available in this lookback.':''}</p>
      {rangeEstimates>0&&<p>{rangeEstimates} {rangeEstimates===1?'day was':'days were'} reported as a range. The graph and weighted average use the midpoint; the original range remains in the tooltip.</p>}
      {legacyEstimates>0&&<p>{legacyEstimates} earlier daily estimates use the original flex convention, which included any running fuel. They retain that source definition here; tooltips identify those dates.</p>}
      <p>Today is excluded until it is complete as a calendar day. The date above sets the end of the lookback; all graphs below always show the full saved history.</p>
    </div></details>
    <div className={styles.chartHeading}><div><h3>Daily nutrition trends</h3><p>Full history · the lookback above does not crop these graphs.</p></div><span>{fullDate(from)} – {fullDate(through)}</span></div>
    <div className={styles.meta}><span>{recorded} of {days.length} days have records{estimates>0?` · ${estimates} historical estimates`:""}</span></div>
    {!recorded&&!hasEnergy?<div className={styles.empty}><ChartNoAxesCombined size={28}/><h3>No saved history yet</h3><p>Log food or connect WHOOP to see daily trends. Dates without records stay unknown.</p></div>:<>
      <div className={styles.historyCharts}>
        <div className={styles.panel}>
          <div className={styles.panelHeader}><div><h3>Calories & weight</h3><p>{calorieSeriesVisible?'Left axis: calories':''}{calorieSeriesVisible&&weightVisible?' · ':''}{weightVisible?'Right axis: pounds':''}{!energyVisible.length?'Choose a series below':''}</p></div><span>{fullDate(energyDays[0]?.date??from)} – {fullDate(energyDays.at(-1)?.date??through)}</span></div>
          <div className={styles.legend} role="group" aria-label="Visible calorie and weight series">{energySeries.map(series=><button type="button" key={series.key} aria-pressed={energyVisible.includes(series.key)}
            onClick={()=>setEnergyVisible(current=>current.includes(series.key)?current.filter(key=>key!==series.key):[...current,series.key])}><i style={{background:series.color}}/>{series.label}</button>)}</div>
          <div className={styles.energyChart} aria-label={`Full-history chart: ${energySeries.filter(series=>energyVisible.includes(series.key)).map(series=>series.label).join(', ')||'no series selected'}`}>
            {energyVisible.length&&selectedEnergyHasData?<ResponsiveContainer width="100%" height="100%" initialDimension={{width:680,height:300}}>
              <LineChart accessibilityLayer data={energyDays} margin={{top:14,right:8,bottom:8,left:0}}>
                {axes}<YAxis yAxisId="calories" hide={!calorieSeriesVisible} width={58} domain={calorieDomain} allowDataOverflow tick={{fill:"#776b7d",fontSize:11}} axisLine={false} tickLine={false} tickFormatter={n=>Number(n).toLocaleString("en-US")} label={{value:'kcal',position:'insideTopLeft',fill:'#776b7d',fontSize:10,offset:-13}}/>
                {weightVisible&&<YAxis yAxisId="weight" orientation="right" width={52} domain={['auto','auto']} ticks={weightDays?undefined:[]} tick={{fill:'#527fa5',fontSize:11}} axisLine={false} tickLine={false} tickFormatter={n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:1})} label={{value:'lb',position:'insideTopRight',fill:'#527fa5',fontSize:10,offset:-13}}/>}
                {energyVisible.includes('netKcal')&&<ReferenceLine yAxisId="calories" y={0} stroke="#9b88a6" strokeDasharray="4 4"/>}
                <Tooltip content={<EnergyTooltip visible={energyVisible}/>} filterNull={false}/>
                {energySeries.filter(series=>energyVisible.includes(series.key)).map(series=><Line key={series.key} yAxisId={series.axis} type="linear" dataKey={series.key} name={series.label} stroke={series.color} strokeWidth={series.key==='netKcal'?2.5:2} strokeDasharray={series.dash}
                  connectNulls={series.key==='weightLb'} dot={{r:series.key==='weightLb'?3:energyDays.length<=31?2.5:1.5,fill:series.key==='weightLb'?series.color:'#fff',strokeWidth:1.5}} activeDot={{r:5,fill:series.color,stroke:'#fff',strokeWidth:2}} isAnimationActive={false}/>)}
              </LineChart>
            </ResponsiveContainer>:<p className={styles.noSeries}>{energyVisible.length?'No known values for the selected series yet. Choose another series above to view available records.':'Choose a calorie or weight series above to show its history.'}</p>}
          </div>
          <p className={styles.shareNote}>{energyVisible.includes('netKcal')?'Eaten − burned is shown only where logged calories and a full-day burn estimate are both known; the dashed line marks zero. ':''}{calorieSeriesVisible?'Burn is allocated from completed WHOOP cycles; workout calories are not added again. ':''}{weightVisible?(weightDays?`${weightDays} weight ${weightDays===1?'record':'records'} shown on recorded or observed dates.${weightDays>1?' The line connects observations; weights between them remain unknown.':''}`:'No dated weight readings yet. A current profile weight is not backfilled into earlier days.'):''}</p>
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
        <div className={styles.panelHeader}><div><h3>Eat to Live balance</h3><p>ETL balance, regular flex, and running fuel</p></div><span>{classified} of {days.length} ETL dates classified</span></div>
        <div className={styles.legend}>{shares.map(s=><span key={s.key}><i style={{background:s.color}}/>{s.label}</span>)}</div>
        {classified?<div className={styles.shareChart} aria-label="Daily ETL, flex, and running-fuel percentages of recorded energy">
          <ResponsiveContainer width="100%" height="100%" initialDimension={{width:680,height:230}}>
            <LineChart accessibilityLayer data={days} margin={{top:8,right:12,bottom:8,left:0}}>
              {axes}<YAxis width={42} domain={[0,100]} ticks={[0,25,50,75,100]} tickFormatter={n=>`${n}%`} tick={{fill:"#776b7d",fontSize:11}} axisLine={false} tickLine={false}/>
              <Tooltip content={<ChartTooltip kind="shares"/>} filterNull={false}/>
              {shares.map(s=><Line key={s.key} type="linear" dataKey={s.key} name={s.label} stroke={s.color} strokeDasharray={s.dash} strokeWidth={2} connectNulls={false} dot={{r:days.length<=31?2.5:1.5,fill:"#fff",strokeWidth:1.5}} activeDot={{r:4}} isAnimationActive={false}/>)}
            </LineChart>
          </ResponsiveContainer>
        </div>:<p className={styles.classificationEmpty}>ETL balance is not available yet. Total calories and regular-flex calories need a recorded classification.</p>}
        <p className={styles.shareNote}>ETL balance excludes regular flex. Running fuel is shown separately and does not reduce the score, so these percentages are not intended to add to 100%.</p>
      </div>
    </>}
    <details className={styles.values}><summary>About partial logs & missing values</summary><div className={styles.note}><Info size={16}/><p>These are recorded amounts, not assumed full-day intake. Known partial sums keep their coverage in the tooltip. Missing nutrition and burn values break their lines. The weight line joins observations without filling in unknown weights between them. ETL balance needs a regular-flex classification; running-fuel percentages remain unknown when that breakdown is missing. Saved meals take precedence over historical nutrition totals for the same date.</p></div></details>
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
