// The made-up makers' rackets as drawn (data/racket-looks/<id>.json), by racket id (data/rackets.json). Generated
// alongside the rackets themselves; plain imports so Node tools load it as Vite does.
import type { RacketLook } from './racket.ts';
import qarroYunque from '../../../data/racket-looks/qarro-yunque.json' with { type: 'json' };
import qarroTralla from '../../../data/racket-looks/qarro-tralla.json' with { type: 'json' };
import qarroForja from '../../../data/racket-looks/qarro-forja.json' with { type: 'json' };
import qarroMartinete from '../../../data/racket-looks/qarro-martinete.json' with { type: 'json' };
import lumbraRemanso from '../../../data/racket-looks/lumbra-remanso.json' with { type: 'json' };
import lumbraSosiego from '../../../data/racket-looks/lumbra-sosiego.json' with { type: 'json' };
import lumbraCandil from '../../../data/racket-looks/lumbra-candil.json' with { type: 'json' };
import lumbraAlbada from '../../../data/racket-looks/lumbra-albada.json' with { type: 'json' };
import vilanoVencejo from '../../../data/racket-looks/vilano-vencejo.json' with { type: 'json' };
import vilanoPavesa from '../../../data/racket-looks/vilano-pavesa.json' with { type: 'json' };
import vilanoAlcotan from '../../../data/racket-looks/vilano-alcotan.json' with { type: 'json' };
import vilanoCometa from '../../../data/racket-looks/vilano-cometa.json' with { type: 'json' };
import granzaLija from '../../../data/racket-looks/granza-lija.json' with { type: 'json' };
import granzaPedernal from '../../../data/racket-looks/granza-pedernal.json' with { type: 'json' };
import granzaCardo from '../../../data/racket-looks/granza-cardo.json' with { type: 'json' };
import granzaEsmeril from '../../../data/racket-looks/granza-esmeril.json' with { type: 'json' };
import paliqueTertulia from '../../../data/racket-looks/palique-tertulia.json' with { type: 'json' };
import paliqueSobremesa from '../../../data/racket-looks/palique-sobremesa.json' with { type: 'json' };
import paliqueRecreo from '../../../data/racket-looks/palique-recreo.json' with { type: 'json' };
import paliqueVerbena from '../../../data/racket-looks/palique-verbena.json' with { type: 'json' };
import orzaProa from '../../../data/racket-looks/orza-proa.json' with { type: 'json' };
import orzaQuilla from '../../../data/racket-looks/orza-quilla.json' with { type: 'json' };
import orzaTimon from '../../../data/racket-looks/orza-timon.json' with { type: 'json' };
import orzaGalerna from '../../../data/racket-looks/orza-galerna.json' with { type: 'json' };

export const LOOKS_BY_RACKET: Record<string, RacketLook> = {
  'qarro-yunque': qarroYunque as RacketLook,
  'qarro-tralla': qarroTralla as RacketLook,
  'qarro-forja': qarroForja as RacketLook,
  'qarro-martinete': qarroMartinete as RacketLook,
  'lumbra-remanso': lumbraRemanso as RacketLook,
  'lumbra-sosiego': lumbraSosiego as RacketLook,
  'lumbra-candil': lumbraCandil as RacketLook,
  'lumbra-albada': lumbraAlbada as RacketLook,
  'vilano-vencejo': vilanoVencejo as RacketLook,
  'vilano-pavesa': vilanoPavesa as RacketLook,
  'vilano-alcotan': vilanoAlcotan as RacketLook,
  'vilano-cometa': vilanoCometa as RacketLook,
  'granza-lija': granzaLija as RacketLook,
  'granza-pedernal': granzaPedernal as RacketLook,
  'granza-cardo': granzaCardo as RacketLook,
  'granza-esmeril': granzaEsmeril as RacketLook,
  'palique-tertulia': paliqueTertulia as RacketLook,
  'palique-sobremesa': paliqueSobremesa as RacketLook,
  'palique-recreo': paliqueRecreo as RacketLook,
  'palique-verbena': paliqueVerbena as RacketLook,
  'orza-proa': orzaProa as RacketLook,
  'orza-quilla': orzaQuilla as RacketLook,
  'orza-timon': orzaTimon as RacketLook,
  'orza-galerna': orzaGalerna as RacketLook,
};
