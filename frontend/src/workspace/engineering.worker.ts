import { runMonteCarlo, rebalanceRPW, optimizeSimulatedAnnealing } from '../domain/edgeEngineering';
import type {Study} from '../domain/types';
type Job={id:number;method:'risk'|'sa'|'rpw';study:Study;iterations:number;cv:number};
self.onmessage=(event:MessageEvent<Job>)=>{
  const {id,method,study,iterations,cv}=event.data;
  try{
    const value=method==='risk'?runMonteCarlo(study,iterations,cv,47):
      method==='sa'?optimizeSimulatedAnnealing(study,iterations):rebalanceRPW(study);
    self.postMessage({id,value});
  }catch(error){self.postMessage({id,error:error instanceof Error?error.message:String(error)})}
};
