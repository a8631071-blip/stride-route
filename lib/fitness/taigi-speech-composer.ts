// StrideRoute Taiwanese hybrid context-first voice pack V24
// V24 keeps V23/V22 coverage fallbacks, adds RAW199 V4 complete integer/decimal readings,
// and prefers whole-number speech units before fragmented legacy number tokens.
export type WorkoutType = "walk" | "run" | "shopping" | "bike";
export type WorkoutState = "start" | "pause" | "resume" | "end";

const compoundDigit: Record<number,string> = {
  0:"num_zero",1:"num_one_compound",2:"num_two_compound",3:"num_three",4:"num_four",
  5:"num_five",6:"num_six",7:"num_seven",8:"num_eight",9:"num_nine"
};
const measureDigit: Record<number,string> = {
  0:"num_zero",1:"num_one_measure",2:"num_two_measure",3:"num_three",4:"num_four",
  5:"num_five",6:"num_six",7:"num_seven",8:"num_eight",9:"num_nine"
};
const decimalDigit: Record<number,string> = {
  0:"decimal_0",1:"decimal_1",2:"decimal_2",3:"decimal_3",4:"decimal_4",
  5:"decimal_5",6:"decimal_6",7:"decimal_7",8:"decimal_8",9:"decimal_9"
};

// RAW50 V3 complete human contexts. The AI V6 overrides below are the frozen
// CANDIDATE_03 / S1-e3 release-review outputs accepted for V23 despite the
// known "二 / jī" accent limitation. Nothing here runs an AI model on-device.
const fullTimeContext: Record<number,string> = {
  5:"time_ctx_05m",10:"time_ctx_10m",15:"time_ctx_15m",20:"time_ctx_20m",
  22:"ai_v6_time_22m",30:"time_ctx_30m",45:"time_ctx_45m",46:"time_ctx_46m",
  60:"time_ctx_60m",65:"time_ctx_1h05m",90:"time_ctx_1h30m"
};

const fullDistanceContext: Record<string,string> = {
  "0.01":"distance_ctx_01",
  "0.05":"distance_ctx_02",
  "0.09":"distance_ctx_03",
  // V6 frozen AI full-sentence contexts.
  "1.01":"ai_v6_distance_1_01",
  "1.02":"distance_ctx_05",
  "1.03":"distance_ctx_06",
  "1.04":"distance_ctx_07",
  "1.05":"distance_ctx_08",
  "1.06":"distance_ctx_09",
  "1.07":"distance_ctx_10",
  "1.08":"distance_ctx_11",
  "1.09":"distance_ctx_12",
  "1.1":"distance_ctx_13",
  "1.11":"distance_ctx_14",
  "1.23":"distance_ctx_15",
  "1.5":"distance_ctx_16",
  "1.78":"distance_ctx_17",
  "1.99":"distance_ctx_18",
  "2":"ai_v6_distance_2_00",
  "2.01":"ai_v6_distance_2_01",
  "2.22":"ai_v6_distance_2_22",
  "3.45":"ai_v6_distance_3_45",
  "3.78":"distance_ctx_19",
  "10.5":"distance_ctx_20"
};

const fullStepContext: Record<number,string> = {
  100:"steps_ctx_100",500:"steps_ctx_500",1000:"steps_ctx_1000",1894:"steps_ctx_1894",
  4923:"steps_ctx_4923",5005:"steps_ctx_5005",7654:"steps_ctx_7654",9999:"steps_ctx_9999",
  10000:"steps_ctx_10000",12345:"steps_ctx_12345"
};

const fullCalorieContext: Record<number,string> = {
  50:"calorie_ctx_50",120:"calorie_ctx_120",200:"calorie_ctx_200",
  326:"calorie_ctx_326",422:"calorie_ctx_422",500:"calorie_ctx_500"
};

function distanceContextKey(distanceMeters:number):string {
  return (Math.max(0,distanceMeters)/1000).toFixed(3).replace(/0+$/g,"").replace(/\.$/,"");
}

export function precomposedTimeToken(minutes:number):string|null {
  return fullTimeContext[Math.max(0,Math.round(minutes))] ?? null;
}

export function precomposedDistanceToken(type:WorkoutType,distanceMeters:number):string|null {
  // RAW50/V6 distance contexts say "已經走 … 公里". They are correct for
  // walking/shopping, but must not replace the distinct run/bike verb.
  if(type!=="walk" && type!=="shopping") return null;
  return fullDistanceContext[distanceContextKey(distanceMeters)] ?? null;
}

export function precomposedStepToken(steps:number):string|null {
  return fullStepContext[Math.max(0,Math.round(steps))] ?? null;
}

export function precomposedCalorieToken(calories:number):string|null {
  return fullCalorieContext[Math.max(0,Math.round(calories))] ?? null;
}

function under10000(n:number, standalone:boolean):string[] {
  n=Math.max(0,Math.floor(n));
  if(n===0)return["num_zero"];
  if(n<10)return[standalone?measureDigit[n]:compoundDigit[n]];
  const out:string[]=[]; let r=n;
  const th=Math.floor(r/1000);
  if(th){out.push(measureDigit[th],"num_thousand");r%=1000;if(r>0&&r<100)out.push("num_zero");}
  const hu=Math.floor(r/100);
  if(hu){out.push(measureDigit[hu],"num_hundred");r%=100;if(r>0&&r<10)out.push("num_zero");}
  const te=Math.floor(r/10);
  if(te){if(te>1)out.push(compoundDigit[te]);out.push("num_ten");r%=10;if(r)out.push(compoundDigit[r]);}
  else if(r)out.push(compoundDigit[r]);
  return out;
}

function fullIntegerToken(value:number):string|null {
  const n=Math.max(0,Math.round(value));
  return n>=1&&n<=100 ? `integer_full_${String(n).padStart(3,"0")}` : null;
}

export function integerTokens(value:number, standalone=true):string[] {
  let n=Math.max(0,Math.round(value));
  if(n===0)return["num_zero"];
  const full=fullIntegerToken(n);
  if(full)return[full];
  if(n<10000)return under10000(n,standalone);
  const out:string[]=[];
  const yi=Math.floor(n/100000000);
  if(yi){out.push(...under10000(yi,true),"num_hundred_million");n%=100000000;if(n>0&&n<10000000)out.push("num_zero");}
  const wan=Math.floor(n/10000);
  if(wan){out.push(...under10000(wan,true),"num_ten_thousand");n%=10000;if(n>0&&n<1000)out.push("num_zero");}
  if(n)out.push(...under10000(n,false));
  return out;
}

export function stateTokens(type:WorkoutType,state:WorkoutState):string[] {
  if(state==="pause")return["state_pause"];
  if(state==="resume")return["state_resume"];
  if(state==="end")return["state_end"];
  if(type==="walk")return["state_walk_start"];
  if(type==="shopping")return["state_shopping_start"];
  if(type==="run")return["state_run_start"];
  return["state_bike_start"];
}

export function movementVerb(type:WorkoutType,completed=false):string {
  if(type==="run")return completed?"word_ran":"word_run";
  if(type==="bike")return completed?"word_rode":"word_ride";
  return completed?"word_walked":"word_walk";
}

export function distanceTokens(distanceMeters:number):string[] {
  // V24 follows the UI/TTS precision: at most 2 decimal places. RAW199 V4
  // decimal_full_01..99 already include the spoken decimal point; trailing zero
  // recordings intentionally collapse (.10 -> .1, .20 -> .2).
  const hundredths=Math.max(0,Math.round((distanceMeters/1000)*100));
  const whole=Math.floor(hundredths/100);
  const fraction=hundredths%100;
  const out:string[]=[];
  if(whole>0)out.push(...integerTokens(whole,true));
  else if(fraction===0)out.push("num_zero");
  if(fraction>0)out.push(`decimal_full_${String(fraction).padStart(2,"0")}`);
  out.push("unit_kilometer");
  return out;
}

export function progressDistanceTokens(type:WorkoutType,distanceMeters:number,encouragementKey?:string):string[] {
  const contextToken=precomposedDistanceToken(type,distanceMeters);
  return[
    ...(encouragementKey?[encouragementKey,"pause_short"]:[]),
    ...(contextToken?[contextToken]:["word_already",movementVerb(type,false),...distanceTokens(distanceMeters)])
  ];
}

export function progressTimeTokens(minutes:number,encouragementKey?:string):string[] {
  const contextToken=precomposedTimeToken(minutes);
  return[
    ...(encouragementKey?[encouragementKey,"pause_short"]:[]),
    ...(contextToken?[contextToken]:["word_already","word_workout",...integerTokens(minutes,true),"unit_minutes"])
  ];
}

function summaryTimeTokens(minutes:number):string[] {
  const contextToken=precomposedTimeToken(minutes);
  return contextToken?[contextToken]:["word_workout",...integerTokens(minutes,true),"unit_minutes"];
}

export function endSummaryTokens(input:{
  type:WorkoutType;minutes:number;distanceMeters:number;steps:number;caloriesKcal?:number|null;
  encouragementKey?:string;closingKey?:string;
}):string[] {
  const out:string[]=[
    ...(input.encouragementKey?[input.encouragementKey,"pause_short"]:[]),
    "word_today","word_total",movementVerb(input.type,true),...distanceTokens(input.distanceMeters),
    "pause_medium",...summaryTimeTokens(input.minutes)
  ];
  if(input.type!=="bike"){
    const fullSteps=precomposedStepToken(input.steps);
    out.push("pause_medium",...(fullSteps?[fullSteps]:["word_altogether",...integerTokens(Math.max(0,Math.round(input.steps)),true),"unit_step"]));
  }
  if(input.caloriesKcal != null && Number.isFinite(input.caloriesKcal) && input.caloriesKcal > 0){
    const fullCalories=precomposedCalorieToken(input.caloriesKcal);
    out.push("pause_medium",...(fullCalories?[fullCalories]:["phrase_calories",...integerTokens(Math.max(0,Math.round(input.caloriesKcal)),true),"unit_kcal"]));
  }
  if(input.closingKey)out.push("pause_long",input.closingKey);
  return out;
}
