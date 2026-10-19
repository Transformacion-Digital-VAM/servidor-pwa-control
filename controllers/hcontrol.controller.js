const Credito = require('../models/Credito');
const Miembro = require('../models/Miembro');
const Grupo = require('../models/Grupo');
const Cliente = require('../models/Cliente');
const { consolidarPagosIndividual } = require('./credito.controller');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Instancia global de Puppeteer
let _browser;
const getBrowser = async () => {
    if (!_browser || !_browser.connected) {
        console.log('[Puppeteer] Iniciando instancia del navegador...');

        const options = {
            headless: true,
            pipe: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        };

        
        const possibleCacheDirs = [
            path.join(process.cwd(), '.puppeteer-cache'),
            process.env.PUPPETEER_CACHE_DIR,
            '/opt/render/.cache/puppeteer'
        ].filter(Boolean);

        console.log(`[Puppeteer] Buscando Chrome en: ${possibleCacheDirs.join(', ')}`);

        for (const cacheDir of possibleCacheDirs) {
            try {
                if (fs.existsSync(cacheDir)) {
                    // Función recursiva simple
                    const findChrome = (dir) => {
                        const files = fs.readdirSync(dir);
                        for (const file of files) {
                            const fullPath = path.join(dir, file);
                            const stat = fs.statSync(fullPath);
                            if (stat.isDirectory()) {
                                const found = findChrome(fullPath);
                                if (found) return found;
                            } else if ((file === 'chrome' || file === 'chromium') && (stat.mode & 0o111)) {
                                return fullPath;
                            }
                        }
                        return null;
                    };

                    const executablePath = findChrome(cacheDir);
                    if (executablePath) {
                        console.log('[Puppeteer] Ejecutable encontrado dinámicamente:', executablePath);
                        options.executablePath = executablePath;
                        break; // Encontrado, salir del loop
                    }
                }
            } catch (err) {
                console.error(`[Puppeteer] Error buscando en ${cacheDir}:`, err.message);
            }
        }


        try {
            _browser = await puppeteer.launch(options);
            console.log('[Puppeteer] Navegador iniciado correctamente.');
        } catch (error) {
            console.error('[Puppeteer] Error al iniciar navegador:', error.message);
            // Si falla, volver a intentar
            if (options.executablePath) {
                console.log('[Puppeteer] Reintentando sin executablePath explícito...');
                delete options.executablePath;
                _browser = await puppeteer.launch(options);
            } else {
                throw error;
            }
        }
    }
    return _browser;
};



const obtenerMetodosDesglosados = (p) => {
    if (!p) return { siglas: ['E'], nombres: ['EFECTIVO'], siglaStr: 'E', nombreStr: 'EFECTIVO' };

    const siglas = [];
    const nombres = [];

    const agregar = (sigla, nombre) => {
        if (!siglas.includes(sigla)) siglas.push(sigla);
        if (!nombres.includes(nombre)) nombres.push(nombre);
    };

    // 1. Desglose numérico de crédito
    const efC = Number(p.efectivoCredito) || 0;
    const trC = Number(p.transferenciaCredito) || 0;
    const dpC = Number(p.depositoCredito) || 0;
    const tjC = Number(p.tarjetaCredito) || 0;

    // 2. Desglose numérico de solidario
    const efS = Number(p.efectivoSolidario) || 0;
    const trS = Number(p.transferenciaSolidario) || 0;
    const dpS = Number(p.depositoSolidario) || 0;
    const tjS = Number(p.tarjetaSolidario) || 0;

    // 3. Garantía aplicada
    const montoGar = Number(p.montoGarantia) || 0;
    const usaGar = p.aplicaGarantia === true;

    if (efC > 0 || efS > 0) agregar('E', 'EFECTIVO');
    if (trC > 0 || trS > 0) agregar('T', 'TRANSFERENCIA');
    if (dpC > 0 || dpS > 0) agregar('D', 'DEPÓSITO');
    if (tjC > 0 || tjS > 0) agregar('TJ', 'TARJETA');
    if (montoGar > 0 || usaGar) agregar('GAR', 'GARANTÍA');

    // 4. Beneficiarios solidarios con método individual
    if (Array.isArray(p.beneficiariosSolidarios) && p.beneficiariosSolidarios.length > 0) {
        p.beneficiariosSolidarios.forEach(b => {
            const m = (b.metodo || '').toUpperCase();
            if (m === 'E') agregar('E', 'EFECTIVO');
            else if (m === 'T') agregar('T', 'TRANSFERENCIA');
            else if (m === 'D') agregar('D', 'DEPÓSITO');
            else if (m === 'TJ') agregar('TJ', 'TARJETA');
        });
    }

    // 5. Fallback si no hubo desglose numérico
    if (siglas.length === 0) {
        const met = String(p.metodoPago || p.metodoPagoSolidario || 'EFECTIVO').trim().toUpperCase();
        switch (met) {
            case 'EFECTIVO':
            case 'E':
                agregar('E', 'EFECTIVO');
                break;
            case 'TRANSFERENCIA':
            case 'T':
                agregar('T', 'TRANSFERENCIA');
                break;
            case 'DEPOSITO':
            case 'DEPÓSITO':
            case 'D':
                agregar('D', 'DEPÓSITO');
                break;
            case 'TARJETA':
            case 'TJ':
                agregar('TJ', 'TARJETA');
                break;
            case 'GARANTIA':
            case 'GARANTÍA':
            case 'GAR':
            case 'G':
                agregar('GAR', 'GARANTÍA');
                break;
            case 'MIXTO':
            case 'MIX':
                agregar('MIX', 'MIXTO');
                break;
            default:
                agregar(met.length <= 3 ? met : met.slice(0, 3), met);
                break;
        }
    }

    return {
        siglas,
        nombres,
        siglaStr: siglas.join('/'),
        nombreStr: nombres.join(' / ')
    };
};

const obtenerSiglaMetodo = (metodo) => {
    if (!metodo) return 'E';
    const m = String(metodo).trim().toUpperCase();
    switch (m) {
        case 'EFECTIVO':
        case 'E':
            return 'E';
        case 'TRANSFERENCIA':
        case 'T':
            return 'T';
        case 'DEPOSITO':
        case 'DEPÓSITO':
        case 'D':
            return 'D';
        case 'TARJETA':
        case 'TJ':
            return 'TJ';
        case 'MIXTO':
        case 'MIX':
            return 'MIX';
        case 'GARANTIA':
        case 'GARANTÍA':
        case 'GAR':
        case 'G':
            return 'GAR';
        default:
            return m.length <= 3 ? m : m.slice(0, 3);
    }
};

const obtenerNombreMetodo = (metodo) => {
    if (!metodo) return 'EFECTIVO';
    const m = String(metodo).trim().toUpperCase();
    switch (m) {
        case 'EFECTIVO':
        case 'E':
            return 'EFECTIVO';
        case 'TRANSFERENCIA':
        case 'T':
            return 'TRANSFERENCIA';
        case 'DEPOSITO':
        case 'DEPÓSITO':
        case 'D':
            return 'DEPÓSITO';
        case 'TARJETA':
        case 'TJ':
            return 'TARJETA';
        case 'MIXTO':
        case 'MIX':
            return 'MIXTO';
        case 'GARANTIA':
        case 'GARANTÍA':
        case 'GAR':
        case 'G':
            return 'GARANTÍA';
        default:
            return m;
    }
};

exports.generarHojaControlGrupal = async (req, res) => {
    const { grupoId, ciclo } = req.params;

    try {
        // 1. OBTENER MIEMBROS DEL GRUPO
        const miembros = await Miembro.find({ grupo: grupoId });
        const miembrosIds = miembros.map(m => m._id);

        if (miembrosIds.length === 0) {
            return res.status(404).json({ message: "No se encontraron miembros para este grupo" });
        }

        // 2. OBTENER CRÉDITOS PARA ESE CICLO Y MIEMBROS
        let creditosRaw = await Credito.find({
            miembro: { $in: miembrosIds },
            ciclo: ciclo
        })
            .populate({
                path: 'miembro',
                populate: { path: 'grupo' }
            })
            .populate('cliente');

        if (creditosRaw.length === 0) {
            // Fallback: Buscar los créditos más recientes o activos de estos miembros
            creditosRaw = await Credito.find({
                miembro: { $in: miembrosIds }
            })
                .sort({ ciclo: -1, createdAt: -1 })
                .populate({
                    path: 'miembro',
                    populate: { path: 'grupo' }
                })
                .populate('cliente');
        }

        if (creditosRaw.length === 0) {
            return res.status(404).json({ message: "No se encontraron créditos para este grupo" });
        }

        // --- CONSOLIDACIÓN DE CRÉDITOS POR MIEMBRO (CONTINUIDAD CC + REFILL) ---
        // Si un miembro tiene CC (semanas 1-8) y R (semanas 9-16), se consolidan en un único registro
        // para que aparezca una sola vez en la hoja de control con todo el historial unificado.
        const creditosPorMiembro = new Map();
        creditosRaw.forEach(c => {
            const mId = c.miembro ? (c.miembro._id ? c.miembro._id.toString() : c.miembro.toString()) : (c.cliente ? (c.cliente._id ? c.cliente._id.toString() : c.cliente.toString()) : c._id.toString());
            if (!creditosPorMiembro.has(mId)) {
                creditosPorMiembro.set(mId, []);
            }
            creditosPorMiembro.get(mId).push(c);
        });

        const creditos = [];
        miembros.forEach(m => {
            const mId = m._id.toString();
            const list = creditosPorMiembro.get(mId);
            if (!list || list.length === 0) return;

            const creditoR = list.find(c => c.tipoCredito === 'R');
            const creditoCC = list.find(c => c.tipoCredito === 'CC');

            if (creditoR && creditoCC) {
                const objR = creditoR.toObject ? creditoR.toObject() : { ...creditoR };
                const objCC = creditoCC.toObject ? creditoCC.toObject() : { ...creditoCC };

                // Combinar pagos de semanas 1-8 (CC) y semanas 9-16 (R)
                const todosLosPagos = [...(objCC.pagos || []), ...(objR.pagos || [])];
                todosLosPagos.sort((a, b) => (a.numeroPago || 0) - (b.numeroPago || 0));

                const todosPagosAhorro = [
                    ...((objCC.ahorro && objCC.ahorro.pagosAhorro) || []),
                    ...((objR.ahorro && objR.ahorro.pagosAhorro) || [])
                ];

                const consolidado = {
                    ...objR,
                    _id: objR._id,
                    tipoCredito: 'R',
                    semanas: Math.max(Number(objR.semanas) || 0, Number(objCC.semanas) || 0, 16),
                    pagos: todosLosPagos,
                    ahorro: {
                        montoTotal: (objCC.ahorro?.montoTotal || 0) + (objR.ahorro?.montoTotal || 0),
                        pagosAhorro: todosPagosAhorro
                    },
                    garantia: objR.garantia !== undefined && objR.garantia > 0 ? objR.garantia : (objCC.garantia || 0),
                    fechaPrimerPago: objCC.fechaPrimerPago || objR.fechaPrimerPago,
                    frecuenciaPago: objCC.frecuenciaPago || objR.frecuenciaPago || 'Semanal'
                };
                creditos.push(consolidado);
            } else {
                const c = list[0];
                creditos.push(c.toObject ? c.toObject() : c);
            }
        });

        // Fallback en caso de créditos sin miembro en el listado inicial
        creditosPorMiembro.forEach((list, mId) => {
            const yaAgregado = creditos.some(c => {
                const idActual = c.miembro ? (c.miembro._id ? c.miembro._id.toString() : c.miembro.toString()) : '';
                return idActual === mId;
            });
            if (!yaAgregado && list.length > 0) {
                creditos.push(list[0].toObject ? list[0].toObject() : list[0]);
            }
        });

        // 3. FUNCIONES DE APOYO
        const formatoMoneda = (num) =>
            Number(num).toLocaleString('es-MX', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });

        const generarCalendario = (fechaInicio, semanas, semanaInicioReal = 1, frec = 'semanal') => {
            const fechas = [];
            const base = new Date(fechaInicio);
            // Desfase de zona horaria
            base.setMinutes(base.getMinutes() + base.getTimezoneOffset());

            for (let i = 0; i < semanas; i++) {
                let nueva;
                // Calculamos el desplazamiento de periodos desde la semana 1
                let offsetPeriodos = (semanaInicioReal - 1) + i;

                if (frec === 'mensual') {
                    const temp = new Date(base);
                    const targetDay = temp.getDate();
                    temp.setMonth(temp.getMonth() + offsetPeriodos);
                    if (temp.getDate() !== targetDay) { temp.setDate(0); }
                    nueva = temp;
                } else if (frec === 'quincenal') {
                    nueva = new Date(base);
                    nueva.setDate(base.getDate() + (offsetPeriodos * 15));
                } else if (frec === 'bisemanal') {
                    nueva = new Date(base);
                    nueva.setDate(base.getDate() + (offsetPeriodos * 14));
                } else {
                    nueva = new Date(base);
                    nueva.setDate(base.getDate() + (offsetPeriodos * 7));
                }

                fechas.push({
                    numero: semanaInicioReal + i,
                    fecha: nueva.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }),
                    fechaObj: new Date(nueva)
                });
            }
            return fechas;
        };

        // Determinar las semanas reales del grupo validando según los créditos
        const semanasValidas = creditos
            .map(c => Number(c.semanas))
            .filter(s => !isNaN(s) && s > 0);

        let totalSemanasGrupo = 16;
        if (semanasValidas.length > 0) {
            totalSemanasGrupo = Math.max(...semanasValidas);
        } else {
            const todos8S = creditosRaw.length > 0 && creditosRaw.every(c => c.tipoCredito === '8S');
            totalSemanasGrupo = todos8S ? 8 : 16;
        }

        const tieneHistorialCC = creditosRaw.some(c => c.tipoCredito === 'CC');
        const esSoloRefill = !tieneHistorialCC && creditosRaw.length > 0 && creditosRaw.every(c => c.tipoCredito === 'R');
        const esSolo8S = creditosRaw.length > 0 && creditosRaw.every(c => c.tipoCredito === '8S');

        let maxSemanas = totalSemanasGrupo;
        let semanaInicioReal = 1;

        if (req.query.semanaInicio && req.query.semanaInicio !== 'completa') {
            semanaInicioReal = parseInt(req.query.semanaInicio) || 1;
            if (req.query.semanaFin) {
                const fin = parseInt(req.query.semanaFin);
                maxSemanas = Math.max(1, fin - semanaInicioReal + 1);
            } else if (req.query.semanas) {
                maxSemanas = Math.max(1, parseInt(req.query.semanas));
            } else {
                // Bloque estándar de hasta 8 semanas sin sobrepasar el total de semanas del crédito
                const restantes = Math.max(1, totalSemanasGrupo - semanaInicioReal + 1);
                maxSemanas = Math.min(8, restantes);
            }
        } else if (esSoloRefill) {
            // Si todos los créditos del grupo en este ciclo son Refill sin CC previo
            let inicioRefill = Math.floor(totalSemanasGrupo / 2) + 1;
            if (creditos[0] && creditos[0].pagos && creditos[0].pagos.length > 0) {
                const primerPagoNum = Number(creditos[0].pagos[0].numeroPago);
                if (primerPagoNum > 0) inicioRefill = primerPagoNum;
            }
            semanaInicioReal = req.query.semanaInicioRefil ? parseInt(req.query.semanaInicioRefil) : inicioRefill;
            const restantes = Math.max(1, totalSemanasGrupo - semanaInicioReal + 1);
            maxSemanas = Math.min(totalSemanasGrupo, restantes);
        } else {
            // Impresión completa: según el total de semanas que trae el grupo
            semanaInicioReal = 1;
            maxSemanas = totalSemanasGrupo;
        }

        const templatePath = path.join(__dirname, '../templates/hojaControl.html');
        let htmlCompletoOrigin = fs.readFileSync(templatePath, 'utf8');

        // Determinar si se divide en dos hojas (> 16 semanas, ej: 20, 24, 32...)
        const seDivideEnDos = maxSemanas > 16;
        const semanasParte1 = seDivideEnDos ? Math.ceil(maxSemanas / 2) : maxSemanas;
        const semanasParte2 = seDivideEnDos ? (maxSemanas - semanasParte1) : 0;

        const partesConfig = seDivideEnDos ? [
            { numParte: 1, inicioIdx: 0, finIdx: semanasParte1, numSemanas: semanasParte1 },
            { numParte: 2, inicioIdx: semanasParte1, finIdx: maxSemanas, numSemanas: semanasParte2 }
        ] : [
            { numParte: 1, inicioIdx: 0, finIdx: maxSemanas, numSemanas: maxSemanas }
        ];

        const totalHojas = seDivideEnDos ? 4 : 2;

        let sumaPagoPactado = 0;
        let sumaSaldoTotal = 0;
        let sumaGarantiaInicial = 0;

        const llena = req.query.llena === 'true';
        const sumasSemanalesMod = new Array(maxSemanas).fill(0);
        const sumIncrementoSemanas = new Array(maxSemanas).fill(0);
        const sumSolidariosSemanas = new Array(maxSemanas).fill(0);

        // Crédito base para fecha y frecuencia: priorizar CC o el que coincida con totalSemanasGrupo
        const creditoBase = creditos.find(c => c.tipoCredito === 'CC' && Number(c.semanas) === totalSemanasGrupo)
            || creditos.find(c => c.tipoCredito === 'CC')
            || creditos.find(c => Number(c.semanas) === totalSemanasGrupo)
            || creditos.find(c => c.tipoCredito !== 'R')
            || creditos[0];

        const fechaBasica = creditoBase?.fechaPrimerPago || creditos[0]?.fechaPrimerPago || new Date();
        const frecGrupo = (creditoBase && creditoBase.frecuenciaPago) ? creditoBase.frecuenciaPago.toLowerCase() : ((creditos[0] && creditos[0].frecuenciaPago) ? creditos[0].frecuenciaPago.toLowerCase() : 'semanal');
        const calendario = generarCalendario(fechaBasica, maxSemanas, semanaInicioReal, frecGrupo);
        const semanaCierreThreshold = Math.max(1, totalSemanasGrupo - 2);

        // Metadatos del grupo
        const unCredito = creditos[0];
        const grupo = unCredito?.miembro?.grupo;
        const grupoNombre = grupo?.nombre || "INDIVIDUAL";
        const diaVisita = grupo?.diaVisita || "________________";
        const horaVisita = grupo?.horaVisita || "________________";
        const claveGrupo = grupo?.clave || "________________";

        let estadoGrupoValor = req.query.estadoGrupo 
            || creditosRaw.find(c => c.estadoGrupo)?.estadoGrupo 
            || creditos.find(c => c.estadoGrupo)?.estadoGrupo;

        if (!estadoGrupoValor) {
            if (esSolo8S) {
                estadoGrupoValor = '8S';
            } else if (esSoloRefill) {
                estadoGrupoValor = 'R';
            } else if (tieneHistorialCC || creditosRaw.some(c => c.tipoCredito === 'CC')) {
                estadoGrupoValor = 'CC';
            } else if (creditosRaw[0]?.tipoCredito && ['CC', 'R', '8S'].includes(creditosRaw[0].tipoCredito)) {
                estadoGrupoValor = creditosRaw[0].tipoCredito;
            } else {
                estadoGrupoValor = 'N/A';
            }
        }
        const estadoGrupo = String(estadoGrupoValor).trim().toUpperCase();

        const logoUrl = "https://static.wixstatic.com/media/0bf950_155f8cd81f6d4fe5ac3419b8e0397b40~mv2.png/v1/crop/x_0,y_260,w_6000,h_2480/fill/w_508,h_210,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/LOGO%20SIN%20FONDO%20OFICIAL.png";

        // Preprocesar datos de cada miembro y todas sus celdas semanales
        const miembrosData = creditos.map((credito, index) => {
            const nombreCliente = credito.cliente
                ? `${credito.cliente.nombre} ${credito.cliente.apellidos}`
                : credito.miembro
                    ? `${credito.miembro.nombre} ${credito.miembro.apellidos}`
                    : "N/A";

            const tipoCredito = credito.tipoCredito || "C.C.";
            const pagoPactado = credito.pagoPactado || 0;
            const saldoTotal = credito.saldoTotal || 0;
            const garantiaInicial = credito.garantia || 0;
            const semanasCreditoMiembro = Number(credito.semanas) || (credito.tipoCredito === '8S' ? 8 : totalSemanasGrupo);
            let cargo = "INTEGRANTE";
            if (credito.miembro && credito.miembro.rol) cargo = credito.miembro.rol.toUpperCase();
            const contributorId = credito.miembro ? credito.miembro._id.toString() : null;

            sumaPagoPactado += pagoPactado;
            sumaSaldoTotal += saldoTotal;
            sumaGarantiaInicial += garantiaInicial;

            const celdasPagos = [];
            const ahorrosSemana = new Array(maxSemanas).fill(0);
            const solidariosSemana = new Array(maxSemanas).fill(0);

            for (let w = 0; w < maxSemanas; w++) {
                let valorCelda = '';
                let tdBgStyle = '';
                const semanaNumeroActual = calendario[w].numero;
                const estaFueraDeRango = semanasCreditoMiembro > 0 && semanaNumeroActual > semanasCreditoMiembro;
                let montoPagoNormalSemana = 0;

                // 1. Celdas de Pagos
                if (llena && credito.pagos) {
                    const pagosSemana = credito.pagos.filter(p => p.numeroPago === semanaNumeroActual);

                    if (pagosSemana.length > 0) {
                        const miembroIdStr = credito.miembro && credito.miembro._id
                            ? credito.miembro._id.toString()
                            : (credito.miembro && credito.miembro.toString ? credito.miembro.toString() : String(credito.miembro || ''));

                        const normalesSemana = [];
                        const solidariosMap = new Map();

                        pagosSemana.forEach(p => {
                            const esSolidario = p.pagoSolidario === true || (Number(p.montoSolidario) > 0 && p.quienPrestoSolidario);
                            let montoP = Number(p.montoPagado) || 0;

                            if (esSolidario) {
                                const prestoId = p.quienPrestoSolidario && p.quienPrestoSolidario._id
                                    ? p.quienPrestoSolidario._id.toString()
                                    : (p.quienPrestoSolidario && p.quienPrestoSolidario.toString ? p.quienPrestoSolidario.toString() : (p.quienPrestoSolidario ? String(p.quienPrestoSolidario) : null));

                                const esRecibido = !prestoId || prestoId !== miembroIdStr;

                                if (esRecibido) {
                                    const ms = Number(p.montoSolidario) || (p.pagoSolidario ? Number(p.montoPagado) : 0) || 0;
                                    if (ms > 0) {
                                        let fechaClave = 'sin_fecha';
                                        if (p.fechaPago) {
                                            const d = new Date(p.fechaPago);
                                            if (!isNaN(d.getTime())) {
                                                const dAdj = new Date(d);
                                                dAdj.setMinutes(dAdj.getMinutes() + dAdj.getTimezoneOffset());
                                                fechaClave = `${dAdj.getFullYear()}-${String(dAdj.getMonth() + 1).padStart(2, '0')}-${String(dAdj.getDate()).padStart(2, '0')}`;
                                            }
                                        }
                                        const numPagoSol = p.numeroPago !== undefined && p.numeroPago !== null ? p.numeroPago : semanaNumeroActual;
                                        const keySol = `${fechaClave}_${numPagoSol}`;

                                        if (!solidariosMap.has(keySol)) {
                                            solidariosMap.set(keySol, []);
                                        }
                                        solidariosMap.get(keySol).push({
                                            pagoOriginal: p,
                                            montoP: ms,
                                            fechaPago: p.fechaPago,
                                            numeroPago: numPagoSol,
                                            esAtraso: p.esAtraso === true,
                                            esAdelanto: p.esAdelanto === true
                                        });
                                    }
                                }
                            } else {
                                if (montoP > 0) {
                                    normalesSemana.push({
                                        pagoOriginal: p,
                                        montoP: montoP,
                                        esSolidario: false,
                                        fechaPago: p.fechaPago,
                                        numeroPago: p.numeroPago !== undefined && p.numeroPago !== null ? p.numeroPago : semanaNumeroActual,
                                        esAtraso: p.esAtraso === true,
                                        esAdelanto: p.esAdelanto === true
                                    });
                                }
                            }
                        });

                        const solidariosAgrupados = [];
                        for (const [key, grupo] of solidariosMap.entries()) {
                            if (grupo.length === 1) {
                                solidariosAgrupados.push({
                                    pagoOriginal: grupo[0].pagoOriginal,
                                    montoP: grupo[0].montoP,
                                    esSolidario: true,
                                    fechaPago: grupo[0].fechaPago,
                                    numeroPago: grupo[0].numeroPago,
                                    esAtraso: grupo[0].esAtraso,
                                    esAdelanto: grupo[0].esAdelanto
                                });
                            } else {
                                const sumaMontoSol = grupo.reduce((acc, item) => acc + item.montoP, 0);

                                let efS = 0, trS = 0, dpS = 0, tjS = 0;
                                const metodosSet = new Set();

                                grupo.forEach(item => {
                                    const po = item.pagoOriginal;
                                    const e = Number(po.efectivoSolidario) || 0;
                                    const t = Number(po.transferenciaSolidario) || 0;
                                    const d = Number(po.depositoSolidario) || 0;
                                    const tj = Number(po.tarjetaSolidario) || 0;

                                    if (e > 0) { efS += e; metodosSet.add('E'); }
                                    if (t > 0) { trS += t; metodosSet.add('T'); }
                                    if (d > 0) { dpS += d; metodosSet.add('D'); }
                                    if (tj > 0) { tjS += tj; metodosSet.add('TJ'); }

                                    if (e === 0 && t === 0 && d === 0 && tj === 0) {
                                        const met = String(po.metodoPago || po.metodoPagoSolidario || 'EFECTIVO').trim().toUpperCase();
                                        if (met === 'TRANSFERENCIA' || met === 'T') { trS += item.montoP; metodosSet.add('T'); }
                                        else if (met === 'DEPOSITO' || met === 'DEPÓSITO' || met === 'D') { dpS += item.montoP; metodosSet.add('D'); }
                                        else if (met === 'TARJETA' || met === 'TJ') { tjS += item.montoP; metodosSet.add('TJ'); }
                                        else { efS += item.montoP; metodosSet.add('E'); }
                                    }
                                });

                                const objConsolidado = {
                                    ...grupo[0].pagoOriginal,
                                    pagoSolidario: true,
                                    montoSolidario: sumaMontoSol,
                                    montoPagado: 0,
                                    efectivoSolidario: efS,
                                    transferenciaSolidario: trS,
                                    depositoSolidario: dpS,
                                    tarjetaSolidario: tjS,
                                    metodoPago: metodosSet.size > 1 ? 'MIXTO' : (Array.from(metodosSet)[0] || 'EFECTIVO'),
                                    quienPrestoSolidario: 'GRUPO_SOLIDARIO',
                                    esAtraso: grupo.some(g => g.esAtraso),
                                    esAdelanto: grupo.every(g => g.esAdelanto)
                                };

                                solidariosAgrupados.push({
                                    pagoOriginal: objConsolidado,
                                    montoP: sumaMontoSol,
                                    esSolidario: true,
                                    fechaPago: grupo[grupo.length - 1].fechaPago,
                                    numeroPago: grupo[0].numeroPago,
                                    esAtraso: grupo.some(g => g.esAtraso),
                                    esAdelanto: grupo.every(g => g.esAdelanto)
                                });
                            }
                        }

                        const itemsAMostrar = [...normalesSemana, ...solidariosAgrupados];
                        itemsAMostrar.sort((a, b) => new Date(a.fechaPago).getTime() - new Date(b.fechaPago).getTime());

                        montoPagoNormalSemana = itemsAMostrar.reduce((acc, it) => acc + it.montoP, 0);
                        const tieneSolidario = solidariosAgrupados.length > 0;

                        const ultimoPagoSemana = itemsAMostrar.length > 0 ? itemsAMostrar[itemsAMostrar.length - 1] : pagosSemana[pagosSemana.length - 1];
                        const fechaSemanaObj = new Date(ultimoPagoSemana.fechaPago || pagosSemana[0].fechaPago);
                        fechaSemanaObj.setMinutes(fechaSemanaObj.getMinutes() + fechaSemanaObj.getTimezoneOffset());
                        fechaSemanaObj.setHours(0, 0, 0, 0);

                        const fechaProgramadaObj = new Date(calendario[w].fechaObj);
                        fechaProgramadaObj.setHours(0, 0, 0, 0);

                        tdBgStyle = tieneSolidario ? 'background-color: #ffd59eff;' : '';

                        if (montoPagoNormalSemana > 0) {
                            const fechaFormato = fechaSemanaObj.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' });

                            const lineasSpan = itemsAMostrar.map((it) => {
                                const montoP = it.montoP;
                                if (montoP <= 0) return '';

                                let colorP = '#2563eb';

                                if (it.esAtraso === true) {
                                    colorP = '#b91c1c';
                                } else if (it.esAdelanto === true) {
                                    colorP = '#2563eb';
                                } else {
                                    const fPago = new Date(it.fechaPago);
                                    fPago.setMinutes(fPago.getMinutes() + fPago.getTimezoneOffset());
                                    fPago.setHours(0, 0, 0, 0);
                                    if (fPago > fechaProgramadaObj) {
                                        colorP = '#b91c1c';
                                    } else {
                                        colorP = '#2563eb';
                                    }
                                }

                                const siglaMetodo = obtenerMetodosDesglosados(it.pagoOriginal).siglaStr;
                                const textoMontoP = it.esSolidario === true ? `${formatoMoneda(montoP)} / SOL` : formatoMoneda(montoP);
                                const fontSize = itemsAMostrar.length > 1 ? '7.5px' : '9px';
                                const siglaFontSize = itemsAMostrar.length > 1 ? '6px' : '7px';

                                return `<div style="display: flex; flex-direction: column; align-items: center; margin-top: 1px;">
                                            <span style="font-weight: bold; font-size: ${fontSize}; color: ${colorP}; line-height: 1.1;">${textoMontoP}</span>
                                            <span style="font-size: ${siglaFontSize}; font-weight: bold; color: #475569; line-height: 1;">(${siglaMetodo})</span>
                                        </div>`;
                            }).filter(Boolean).join('');

                            valorCelda = `<div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%;">
                                        <span style="font-size: 7px; color: #666; margin-bottom: 1px;">${fechaFormato}</span>
                                        ${lineasSpan}
                                      </div>`;
                        }

                        sumasSemanalesMod[w] += montoPagoNormalSemana;
                    }
                }

                if (estaFueraDeRango && !valorCelda) {
                    tdBgStyle = 'background-color: #f1f5f9; color: #94a3b8;';
                    valorCelda = '<span style="color:#cbd5e1; font-weight:bold;">-</span>';
                }

                celdasPagos.push({
                    valorCelda,
                    tdBgStyle,
                    montoPagoNormalSemana
                });

                // 2. Incremento de Garantía (Ahorro)
                if (llena && !estaFueraDeRango) {
                    let montoSemana = 0;
                    if (credito.pagos && credito.pagos.length > 0) {
                        const pagosSemana = credito.pagos.filter(p => Number(p.numeroPago) === Number(semanaNumeroActual));
                        if (pagosSemana.length > 0) {
                            const ahorroSumado = pagosSemana.reduce((sum, p) => {
                                const montoA = Number(p.montoAhorro) || (
                                    (Number(p.efectivoAhorro) || 0) +
                                    (Number(p.transferenciaAhorro) || 0) +
                                    (Number(p.tarjetaAhorro) || 0) +
                                    (Number(p.depositoAhorro) || 0)
                                );
                                return sum + montoA;
                            }, 0);
                            if (ahorroSumado > 0) {
                                montoSemana = ahorroSumado;
                            }
                        }
                    }

                    if (credito.ahorro && credito.ahorro.pagosAhorro && credito.ahorro.pagosAhorro.length > 0) {
                        const ahorrosConNum = credito.ahorro.pagosAhorro.filter(a => Number(a.numeroPago) === Number(semanaNumeroActual));
                        if (ahorrosConNum.length > 0) {
                            montoSemana += ahorrosConNum.reduce((sum, a) => sum + (Number(a.monto) || 0), 0);
                        } else if (montoSemana === 0) {
                            const ahorroPorIndice = credito.ahorro.pagosAhorro[w];
                            if (ahorroPorIndice && ahorroPorIndice.monto > 0 && !ahorroPorIndice.numeroPago) {
                                montoSemana = Number(ahorroPorIndice.monto) || 0;
                            }
                        }
                    }

                    if (montoSemana > 0) {
                        ahorrosSemana[w] = montoSemana;
                        sumIncrementoSemanas[w] += montoSemana;
                    }
                }

                // 3. Solidarios Aportados
                if (llena && contributorId && !estaFueraDeRango) {
                    let montoAportadoPorElMiembro = 0;
                    for (const otroCredito of creditos) {
                        if (otroCredito.pagos) {
                            const pagosSolSemana = otroCredito.pagos.filter(p => p.numeroPago === semanaNumeroActual && p.pagoSolidario === true);
                            for (const pSol of pagosSolSemana) {
                                const prestoId = pSol.quienPrestoSolidario && pSol.quienPrestoSolidario._id
                                    ? pSol.quienPrestoSolidario._id.toString()
                                    : (pSol.quienPrestoSolidario && pSol.quienPrestoSolidario.toString ? pSol.quienPrestoSolidario.toString() : pSol.quienPrestoSolidario);

                                if (otroCredito._id && credito._id && otroCredito._id.toString() === credito._id.toString() && prestoId === contributorId) {
                                    montoAportadoPorElMiembro += pSol.montoSolidario;
                                } else if (otroCredito.miembro && otroCredito.miembro._id.toString() === contributorId && !pSol.quienPrestoSolidario) {
                                    montoAportadoPorElMiembro += pSol.montoSolidario;
                                }
                            }
                        }
                    }
                    if (montoAportadoPorElMiembro > 0) {
                        solidariosSemana[w] = montoAportadoPorElMiembro;
                        sumSolidariosSemanas[w] += montoAportadoPorElMiembro;
                    }
                }
            }

            // Acumulados para este miembro
            const pagosParte1 = celdasPagos.slice(0, semanasParte1).reduce((acc, c) => acc + c.montoPagoNormalSemana, 0);
            const saldoFinParte1 = Math.max(0, saldoTotal - pagosParte1);

            const pagosParte2 = seDivideEnDos ? celdasPagos.slice(semanasParte1, maxSemanas).reduce((acc, c) => acc + c.montoPagoNormalSemana, 0) : 0;
            const saldoFinParte2 = Math.max(0, saldoFinParte1 - pagosParte2);

            const ahorroParte1 = ahorrosSemana.slice(0, semanasParte1).reduce((a, b) => a + b, 0);
            const ahorroParte2 = seDivideEnDos ? ahorrosSemana.slice(semanasParte1, maxSemanas).reduce((a, b) => a + b, 0) : 0;

            let totalAhorroGlobal = 0;
            if (llena) {
                const sumaAhorroPagos = (credito.pagos || []).reduce((sum, p) => {
                    const montoA = Number(p.montoAhorro) || (
                        (Number(p.efectivoAhorro) || 0) +
                        (Number(p.transferenciaAhorro) || 0) +
                        (Number(p.tarjetaAhorro) || 0) +
                        (Number(p.depositoAhorro) || 0)
                    );
                    return sum + montoA;
                }, 0);
                const sumaAhorroIndependiente = (credito.ahorro?.pagosAhorro || []).reduce((sum, a) => sum + (Number(a.monto) || 0), 0);
                const ahorroMontoTotalDoc = Number(credito.ahorro?.montoTotal) || 0;
                totalAhorroGlobal = Math.max(sumaAhorroPagos + sumaAhorroIndependiente, ahorroMontoTotalDoc);
            }

            const totalSolidariosParte1 = solidariosSemana.slice(0, semanasParte1).reduce((a, b) => a + b, 0);
            const totalSolidariosParte2 = seDivideEnDos ? solidariosSemana.slice(semanasParte1, maxSemanas).reduce((a, b) => a + b, 0) : 0;
            const totalSolidariosGlobal = totalSolidariosParte1 + totalSolidariosParte2;

            return {
                credito,
                nombreCliente,
                tipoCredito,
                pagoPactado,
                saldoTotal,
                garantiaInicial,
                semanasCreditoMiembro,
                cargo,
                celdasPagos,
                ahorrosSemana,
                solidariosSemana,
                pagosParte1,
                saldoFinParte1,
                pagosParte2,
                saldoFinParte2,
                ahorroParte1,
                ahorroParte2,
                totalAhorroGlobal,
                totalSolidariosParte1,
                totalSolidariosParte2,
                totalSolidariosGlobal
            };
        });

        // Totales globales
        const sumaPagosParte1 = sumasSemanalesMod.slice(0, semanasParte1).reduce((a, b) => a + b, 0);
        const sumaPagosTotal = sumasSemanalesMod.reduce((a, b) => a + b, 0);

        const sumaAhorroParte1 = sumIncrementoSemanas.slice(0, semanasParte1).reduce((a, b) => a + b, 0);
        const sumaGarantiaFinalTotal = llena ? miembrosData.reduce((acc, m) => acc + m.totalAhorroGlobal, 0) : 0;

        const sumaTotalSolidariosParte1 = sumSolidariosSemanas.slice(0, semanasParte1).reduce((a, b) => a + b, 0);
        const sumaTotalSolidariosTotal = sumSolidariosSemanas.reduce((a, b) => a + b, 0);

        // FUNCIÓN RENDER: HOJA DE CONTROL DE PAGOS
        const renderPaginaControlPagos = (parte, numHoja) => {
            const { numParte, inicioIdx, finIdx, numSemanas } = parte;
            const calendarioSlice = calendario.slice(inicioIdx, finIdx);
            const semIni = calendarioSlice[0]?.numero;
            const semFin = calendarioSlice[calendarioSlice.length - 1]?.numero;
            const esParte1 = numParte === 1;

            const semWidth = Math.max(2.5, Math.min(8.5, +(69 / numSemanas).toFixed(2)));
            const semHeaderFont = numSemanas > 16 ? '7.5px' : '9px';
            const semFechaFont = numSemanas > 16 ? '7px' : '8px';

            let subtitulo = '';
            if (seDivideEnDos) {
                subtitulo = ` - PARTE ${numParte} (SEMANAS ${semIni} A ${semFin})`;
            }

            // THEAD
            let thead = `<tr>
                <th rowspan="2" width="2%">NO.</th>
                <th rowspan="2" width="4%" style="font-size:9px;">TIPO DE<br>CRÉDITO</th>
                <th rowspan="2" width="14%">NOMBRE DEL<br>CLIENTE</th>
                <th rowspan="2" width="7%">PAGO<br>PACTADO</th>`;
            calendarioSlice.forEach(p => {
                thead += `<th width="${semWidth}%" style="font-size:${semHeaderFont};">SEM ${p.numero}</th>`;
            });
            thead += `<th rowspan="2" width="4%">S.F.</th></tr><tr>`;
            calendarioSlice.forEach(p => {
                thead += `<th style="font-size: ${semFechaFont};">${p.fecha}</th>`;
            });
            thead += `</tr>`;

            // TBODY
            let tbody = '';
            miembrosData.forEach((m, idx) => {
                let sfVal = '';
                if (llena) {
                    if (esParte1 && seDivideEnDos) {
                        sfVal = formatoMoneda(m.saldoFinParte1);
                    } else {
                        sfVal = formatoMoneda(m.credito.saldoPendiente !== undefined ? m.credito.saldoPendiente : m.saldoFinParte2);
                    }
                }

                const labelSaldo = (!esParte1 && seDivideEnDos) ? 'S.I.' : 'S.T.';
                const montoSaldoRowB = (!esParte1 && seDivideEnDos)
                    ? (llena ? m.saldoFinParte1 : m.saldoTotal)
                    : m.saldoTotal;

                // Fila A
                tbody += `<tr>
                    <td rowspan="2" align="center" style="font-weight:bold;">${idx + 1}</td>
                    <td align="center" style="font-size:9px; font-weight:bold;">${m.tipoCredito}</td>
                    <td align="center" style="font-size:10px; font-weight:bold; text-transform:uppercase;">${m.nombreCliente}</td>
                    <td rowspan="2" style="font-size:11px;">
                        <div style="display: flex; justify-content: space-between; width: 100%;">
                            <span>$</span>
                            <span>${formatoMoneda(m.pagoPactado)}</span>
                        </div>
                    </td>`;

                for (let w = inicioIdx; w < finIdx; w++) {
                    const celda = m.celdasPagos[w] || { valorCelda: '', tdBgStyle: '' };
                    tbody += `<td rowspan="2" align="center" style="vertical-align: middle; padding:0; ${celda.tdBgStyle};">${celda.valorCelda}</td>`;
                }
                tbody += `<td rowspan="2" align="center" style="font-size:10px; font-weight:bold;">${sfVal}</td></tr>`;

                // Fila B
                tbody += `<tr>
                    <td align="center" style="font-size:9px; font-weight:bold;">${labelSaldo}</td>
                    <td style="font-size: 11px; padding: 0 5px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                            <span>$</span>
                            <span>${formatoMoneda(montoSaldoRowB)}</span>
                        </div>
                    </td>
                </tr>`;
            });

            // Totales - P.P.G.
            tbody += `<tr>
                <td colspan="3" align="center" style="font-weight:bold; font-size:11px; padding: 6px 0;">P.P.G.</td>
                <td style="font-weight:bold; font-size:11px;">
                    <div style="display:flex; justify-content:space-between; width:100%;">
                        <span>$</span><span>${formatoMoneda(sumaPagoPactado)}</span>
                    </div>
                </td>`;
            for (let w = inicioIdx; w < finIdx; w++) {
                let val = llena && sumasSemanalesMod[w] > 0 ? `${formatoMoneda(sumasSemanalesMod[w])}` : '';
                tbody += `<td align="center" style="font-weight:bold; font-size:10px;">${val}</td>`;
            }
            let sfTotal = '';
            if (llena) {
                if (esParte1 && seDivideEnDos) {
                    sfTotal = formatoMoneda(Math.max(0, sumaSaldoTotal - sumaPagosParte1));
                } else {
                    sfTotal = formatoMoneda(Math.max(0, sumaSaldoTotal - sumaPagosTotal));
                }
            }
            tbody += `<td align="center" style="font-weight:bold; font-size:10px; color: #b91c1c;">${sfTotal}</td></tr>`;

            // S.I. / S.S.
            tbody += `<tr>
                <td colspan="4" align="center" style="font-weight:bold; font-size:11px;">S.I.</td>`;
            for (let w = inicioIdx; w < finIdx; w++) {
                tbody += `<td align="center" style="font-weight:bold; font-size:10px;">S.S.</td>`;
            }
            tbody += `<td align="center" style="font-weight:bold; font-size:11px;">S.F.</td></tr>`;

            // Saldo Decreciente
            let saldoBaseInicio = sumaSaldoTotal;
            if (!esParte1 && seDivideEnDos) {
                saldoBaseInicio = Math.max(0, sumaSaldoTotal - sumaPagosParte1);
            }
            tbody += `<tr>
                <td colspan="4" align="right" style="font-weight:bold; font-size:12px; padding-right:10px;"><span>$</span>${formatoMoneda(saldoBaseInicio)}</td>`;

            let saldoAcumulado = saldoBaseInicio;
            for (let w = inicioIdx; w < finIdx; w++) {
                saldoAcumulado -= sumasSemanalesMod[w];
                let val = (llena && sumasSemanalesMod[w] > 0) ? `${formatoMoneda(Math.max(0, saldoAcumulado))}` : '';
                tbody += `<td align="center" style="font-weight:bold; font-size:10px;">${val}</td>`;
            }
            tbody += `<td></td></tr>`;

            return `
            <div class="page-break">
                <div class="header-top">
                    <h2>VAMOS A MEJORAR S.A DE C.V SOFOM ENR</h2>
                    <h4>HOJA DE CONTROL GRUPAL DE PAGOS${subtitulo}</h4>
                    <img src="${logoUrl}" alt="VAM Logo">
                </div>

                <div class="info-grid">
                    <div class="info-col">
                        <div class="info-item">
                            <span class="label">NOMBRE DEL GRUPO:</span>
                            <span class="value">${grupoNombre}</span>
                        </div>
                        <div class="info-item">
                            <span class="label">DIA DE VISITA:</span>
                            <span class="value">${diaVisita}</span>
                        </div>
                    </div>
                    <div class="info-col">
                        <div class="info-item">
                            <span class="label">CLAVE:</span>
                            <span class="value">${claveGrupo}</span>
                        </div>
                        <div class="info-item">
                            <span class="label">HORA DE VISITA:</span>
                            <span class="value">${horaVisita}</span>
                        </div>
                    </div>
                    <div class="info-col">
                        <div class="info-item">
                            <span class="label">CICLO:</span>
                            <span class="value">${ciclo}</span>
                        </div>
                        <div class="info-item">
                            <span class="label">ESTADO GRUPO:</span>
                            <span class="value">${estadoGrupo}</span>
                        </div>
                    </div>
                </div>

                <table class="hoja">
                    <thead>${thead}</thead>
                    <tbody>${tbody}</tbody>
                </table>

                <div class="bank-info"
                    style="margin-top: 15px; border: 1px solid #000; padding: 6px; font-size: 10px; display: flex; justify-content: space-around; background-color: #f9fafb;">
                    <div><b>BBVA</b> &nbsp; CUENTA: 0116885780 &nbsp; CLABE: 012680001168857803</div>
                    <div><b>BANCOPPEL</b> &nbsp; CUENTA: 12000003512 &nbsp; CLABE: 137220120000035129</div>
                    <div><b>INBURSA</b> &nbsp; CUENTA: 50024236364 &nbsp; CLABE: 03624050022423363648</div>
                </div>

                <div class="footer-text">
                    <div>
                        <p>COPIA: ASESOR</p>
                        <p>REV 02-25</p>
                        
                    </div>
                    <div style="text-align: right;">
                        <p>HOJA ${numHoja} DE ${totalHojas}</p>
                        <p style="margin-top: 10px;">FO-46</p>
                    </div>
                </div>
            </div>`;
        };

        // FUNCIÓN RENDER: INCREMENTO DE GARANTÍA Y SOLIDARIOS
        const renderPaginaIncrementoYSolidarios = (parte, numHoja, tieneSalto = true) => {
            const { numParte, inicioIdx, finIdx, numSemanas } = parte;
            const calendarioSlice = calendario.slice(inicioIdx, finIdx);
            const semIni = calendarioSlice[0]?.numero;
            const semFin = calendarioSlice[calendarioSlice.length - 1]?.numero;
            const esParte1 = numParte === 1;

            const semWidth = Math.max(2.5, Math.min(8.5, +(69 / numSemanas).toFixed(2)));
            const semHeaderFont = numSemanas > 16 ? '7.5px' : '9px';

            let subtitulo = '';
            if (seDivideEnDos) {
                subtitulo = ` (SEMANAS ${semIni} A ${semFin})`;
            }

            // TABLA 2: INCREMENTO DE GARANTÍA
            const labelGtiaFinal = (esParte1 && seDivideEnDos) ? 'GTIA.<br>ACUM.' : 'GTIA.<br>FINAL';
            let incThead = `<tr>
                <th colspan="${4 + numSemanas + 1}" align="center" style="font-size:12px; font-weight:bold; color: #000; padding: 5px;">INCREMENTO DE GTIA.${subtitulo}</th>
            </tr>
            <tr>
                <th width="2%">NO.</th>
                <th width="8%">CARGO</th>
                <th width="10%">GARANTIA<br>INICIAL</th>
                <th width="14%">NOMBRE DEL CLIENTE</th>`;
            calendarioSlice.forEach(p => {
                incThead += `<th width="${semWidth}%" style="font-size:${semHeaderFont};">SEM ${p.numero}</th>`;
            });
            incThead += `<th width="4%">${labelGtiaFinal}</th></tr>`;

            let incTbody = '';
            miembrosData.forEach((m, idx) => {
                incTbody += `<tr>
                    <td align="center" style="font-weight:bold;">${idx + 1}</td>
                    <td align="center" style="font-size:9px; font-weight:bold;">${m.cargo}</td>
                    <td align="center" style="font-size:11px;">$ ${formatoMoneda(m.garantiaInicial)}</td>
                    <td align="center" style="font-size:10px; font-weight:bold; text-transform:uppercase;">${m.nombreCliente}</td>`;

                for (let w = inicioIdx; w < finIdx; w++) {
                    const numSem = calendario[w].numero;
                    let bgStyle = (numSem >= semanaCierreThreshold) ? 'background-color: #dbe5f1;' : '';
                    let valCelda = '';
                    if (m.semanasCreditoMiembro > 0 && numSem > m.semanasCreditoMiembro) {
                        valCelda = '-';
                        bgStyle = 'background-color: #f1f5f9; color: #94a3b8;';
                    } else if (llena && m.ahorrosSemana[w] > 0) {
                        valCelda = formatoMoneda(m.ahorrosSemana[w]);
                    }
                    incTbody += `<td align="center" style="${bgStyle} font-size:10px; font-weight:bold;">${valCelda}</td>`;
                }

                let valFinalGtia = '$ ';
                if (llena) {
                    if (esParte1 && seDivideEnDos) {
                        valFinalGtia = formatoMoneda(m.ahorroParte1);
                    } else {
                        valFinalGtia = formatoMoneda(m.totalAhorroGlobal);
                    }
                }
                incTbody += `<td align="left" style="font-weight:bold; font-size:10px;">${valFinalGtia}</td></tr>`;
            });

            // Total Incremento
            const totalGtiaAcum = (esParte1 && seDivideEnDos) ? sumaAhorroParte1 : sumaGarantiaFinalTotal;
            const txtTotalGtia = llena ? `$ ${formatoMoneda(totalGtiaAcum)}` : '$ ';
            incTbody += `<tr>
                <td colspan="2" align="center" style="font-weight:bold; font-size:9px; padding: 5px 0;">TOTAL<br>GARANTIA<br>INICIAL</td>
                <td align="center" style="font-weight:bold; font-size:11px;">$ ${formatoMoneda(sumaGarantiaInicial)}</td>
                <td align="right" style="font-weight:bold; padding-right:10px;">TOTAL</td>`;
            for (let w = inicioIdx; w < finIdx; w++) {
                const numSem = calendario[w].numero;
                let bgStyle = (numSem >= semanaCierreThreshold) ? 'background-color: #dbe5f1;' : '';
                const sumaSem = sumIncrementoSemanas[w] || 0;
                const texto = llena && sumaSem > 0 ? `$ ${formatoMoneda(sumaSem)}` : '$ ';
                incTbody += `<td align="left" style="${bgStyle} font-weight:bold; font-size:10px;">${texto}</td>`;
            }
            incTbody += `<td align="left" style="font-weight:bold; font-size:10px;">${txtTotalGtia}</td></tr>`;

            // TABLA 3: REGISTRO DE SOLIDARIOS
            let solThead = `<tr>
                <th colspan="${3 + numSemanas + 1}" align="center" style="font-size:12px; font-weight:bold; color: #000; padding: 5px;">REGISTRO DE SOLIDARIOS${subtitulo}</th>
            </tr>
            <tr>
                <th width="2%">NO.</th>
                <th width="8%">CARGO</th>
                <th width="14%">NOMBRE DEL CLIENTE</th>`;
            calendarioSlice.forEach(p => {
                solThead += `<th width="${semWidth}%" style="font-size:${semHeaderFont};">SEM ${p.numero}</th>`;
            });
            solThead += `<th width="4%">TOTAL</th></tr>`;

            let solTbody = '';
            miembrosData.forEach((m, idx) => {
                solTbody += `<tr>
                    <td align="center" style="font-weight:bold;">${idx + 1}</td>
                    <td align="center" style="font-size:9px; font-weight:bold;">${m.cargo}</td>
                    <td align="center" style="font-size:10px; font-weight:bold; text-transform:uppercase;">${m.nombreCliente}</td>`;

                for (let w = inicioIdx; w < finIdx; w++) {
                    const numSem = calendario[w].numero;
                    let bgStyle = (numSem >= semanaCierreThreshold) ? 'background-color: #dbe5f1;' : '';
                    let valCelda = '';
                    if (m.semanasCreditoMiembro > 0 && numSem > m.semanasCreditoMiembro) {
                        valCelda = '-';
                        bgStyle = 'background-color: #f1f5f9; color: #94a3b8;';
                    } else if (llena && m.solidariosSemana[w] > 0) {
                        valCelda = formatoMoneda(m.solidariosSemana[w]);
                    }
                    solTbody += `<td align="center" style="${bgStyle} font-size:10px; font-weight:bold; color: #d97706;">${valCelda}</td>`;
                }

                let totSolMiembro = (esParte1 && seDivideEnDos) ? m.totalSolidariosParte1 : m.totalSolidariosGlobal;
                let textTotalSol = llena && totSolMiembro > 0 ? `${formatoMoneda(totSolMiembro)}` : '$ ';
                solTbody += `<td align="left" style="font-weight:bold; font-size:10px;">${textTotalSol}</td></tr>`;
            });

            // Total Solidarios
            const totalSolGrupo = (esParte1 && seDivideEnDos) ? sumaTotalSolidariosParte1 : sumaTotalSolidariosTotal;
            const txtTotalSolid = llena && totalSolGrupo > 0 ? `$ ${formatoMoneda(totalSolGrupo)}` : '$  ';
            solTbody += `<tr>
                <td colspan="3" align="right" style="font-weight:bold; padding-right:10px; padding: 5px 0;">TOTAL</td>`;
            for (let w = inicioIdx; w < finIdx; w++) {
                const numSem = calendario[w].numero;
                let bgStyle = (numSem >= semanaCierreThreshold) ? 'background-color: #dbe5f1;' : '';
                const sumaSem = sumSolidariosSemanas[w] || 0;
                const texto = llena && sumaSem > 0 ? `$ ${formatoMoneda(sumaSem)}` : '$ ';
                solTbody += `<td align="left" style="${bgStyle} font-weight:bold; font-size:10px;">${texto}</td>`;
            }
            solTbody += `<td align="left" style="font-weight:bold; font-size:10px;">${txtTotalSolid}</td></tr>`;

            const claseSalto = tieneSalto ? 'class="page-break"' : '';
            return `
            <div ${claseSalto}>
                <div class="header-secondary" style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 5px;">
                    <div style="font-size: 11px; font-weight: bold; color: #1e293b; text-transform: uppercase;">
                        ${grupoNombre} &nbsp;|&nbsp; CICLO: ${ciclo} &nbsp;|&nbsp; CLAVE: ${claveGrupo}
                    </div>
                    <img src="${logoUrl}" alt="VAM Logo" style="height: 35px;">
                </div>
                <table class="hoja">
                    <thead>${incThead}</thead>
                    <tbody>${incTbody}</tbody>
                </table>

                <!-- Registro de Solidarios en la misma página -->
                <table class="hoja" style="margin-top: 25px;">
                    <thead>${solThead}</thead>
                    <tbody>${solTbody}</tbody>
                </table>

                <div class="footer-text" style="justify-content: flex-end;">
                    <div style="text-align: right;">
                        <p>HOJA ${numHoja} DE ${totalHojas}</p>
                    </div>
                </div>
            </div>`;
        };

        // Generar las páginas del documento
        let paginasHtml = '';
        if (seDivideEnDos) {
            // 4 páginas ordenadas:
            // Hoja 1: Control de Pagos Parte 1 (Sem 1 a mitad)
            paginasHtml += renderPaginaControlPagos(partesConfig[0], 1);
            // Hoja 2: Control de Pagos Parte 2 (Sem mitad+1 a fin)
            paginasHtml += renderPaginaControlPagos(partesConfig[1], 2);
            // Hoja 3: Incremento y Solidarios Parte 1 (Sem 1 a mitad)
            paginasHtml += renderPaginaIncrementoYSolidarios(partesConfig[0], 3, true);
            // Hoja 4: Incremento y Solidarios Parte 2 (Sem mitad+1 a fin)
            paginasHtml += renderPaginaIncrementoYSolidarios(partesConfig[1], 4, false);
        } else {
            // 2 páginas estándar:
            // Hoja 1: Control de Pagos
            paginasHtml += renderPaginaControlPagos(partesConfig[0], 1);
            // Hoja 2: Incremento y Solidarios
            paginasHtml += renderPaginaIncrementoYSolidarios(partesConfig[0], 2, false);
        }

        let htmlCompleto = htmlCompletoOrigin.replace(/<body[^>]*>[\s\S]*?<\/body>/i, '<body>' + paginasHtml + '</body>');

        if (req.query.format === 'html') {
            return res.send(htmlCompleto);
        }

        const browser = await getBrowser();

        const page = await browser.newPage();
        await page.setContent(htmlCompleto, { waitUntil: "load" });

        const pdfBuffer = await page.pdf({
            format: "A4",
            landscape: true,
            printBackground: true,
            margin: { top: '20mm', bottom: '15mm', left: '10mm', right: '10mm' }
        });

        await page.close();

        res.setHeader('Content-Type', 'application/pdf');
        const grupoG = creditos[0]?.miembro?.grupo;
        const nombreG = grupoG?.nombre || "INDIVIDUAL";
        const nombreArchivo = nombreG.replace(/\D/g, '').length === 0 ? nombreG.replace(/[^a-zA-Z0-9]/g, '_') : nombreG.replace(/\s+/g, '_');
        const estadoGrupoParam = (estadoGrupo && estadoGrupo !== 'N/A') ? `_${estadoGrupo}` : (req.query.estadoGrupo ? `_${req.query.estadoGrupo}` : '');
        const disposition = req.query.preview === 'true' ? 'inline' : 'attachment';
        res.setHeader('Content-Disposition', `${disposition}; filename="hoja-control_${nombreArchivo}${estadoGrupoParam}_ciclo_${ciclo}.pdf"`);
        res.send(pdfBuffer);

    } catch (error) {
        console.error("Error generando hoja de control:", error);
        res.status(500).json({
            message: "Error interno",
            error: error.message
        });
    }
};

exports.generarHojaControlIndividual = async (req, res) => {
    const { clienteId, ciclo } = req.params;

    try {
        let creditos = await Credito.find({
            $or: [
                { cliente: clienteId },
                { miembro: clienteId },
                { _id: clienteId }
            ]
        })
            .populate({
                path: 'cliente',
                populate: { path: 'asesor' }
            })
            .populate('miembro')
            .sort({ createdAt: -1 });

        let creditosDelCiclo = creditos.filter(c => c.ciclo == ciclo);

        if (creditosDelCiclo.length === 0) {
            // Fallback: Buscar los créditos más recientes o activos
            const masRec = creditos.length > 0 ? creditos[0] : null;
            if (masRec) {
                creditosDelCiclo = creditos.filter(c => c.ciclo == masRec.ciclo);
            }
        }

        if (creditosDelCiclo.length === 0) {
            return res.status(404).json({ message: "No se encontró el crédito para este cliente" });
        }

        let credito;
        if (creditosDelCiclo.length > 1) {
            const creditoActivo = creditosDelCiclo.find(c => c.estado === 'Activo') || creditosDelCiclo[0];
            const creditoLiquidado = creditosDelCiclo.find(c => c.estado !== 'Activo');

            credito = creditoActivo.toObject ? creditoActivo.toObject() : { ...creditoActivo };

            if (creditoLiquidado) {
                 const objLiquidado = creditoLiquidado.toObject ? creditoLiquidado.toObject() : { ...creditoLiquidado };
                 
                 // Combinar pagos
                 const todosLosPagos = [...(objLiquidado.pagos || []), ...(credito.pagos || [])];
                 todosLosPagos.sort((a, b) => (a.numeroPago || 0) - (b.numeroPago || 0));

                 const todosPagosAhorro = [...((objLiquidado.ahorro && objLiquidado.ahorro.pagosAhorro) || []), ...((credito.ahorro && credito.ahorro.pagosAhorro) || [])];
                 todosPagosAhorro.sort((a, b) => (a.numeroPago || 0) - (b.numeroPago || 0));

                 credito.pagos = todosLosPagos;
                 if (!credito.ahorro) credito.ahorro = {};
                 credito.ahorro.pagosAhorro = todosPagosAhorro;
                 
                 // Respetar la fecha de inicio original y el monto original
                 if (objLiquidado.fechaPrimerPago) {
                     credito.fechaPrimerPago = objLiquidado.fechaPrimerPago;
                 }
            }
        } else {
            credito = creditosDelCiclo[0];
        }

        const esSoloRefill = creditosDelCiclo.length === 1 && (credito.tipoCredito === 'R' || credito.esRefill);

        const formatoMoneda = (num) =>
            Number(num || 0).toLocaleString('es-MX', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });

        const generarCalendario = (fechaInicio, semanasTotales, creditoActual, esSoloRefillFlag) => {
            const fechas = [];
            let currentSaldo = creditoActual.saldoTotal || 0;
            const pagoPactado = creditoActual.pagoPactado || 0;
            const llena = req.query.llena === 'true';

            const baseDate = new Date(fechaInicio);

            // Ajustar fecha base
            baseDate.setMinutes(baseDate.getMinutes() + baseDate.getTimezoneOffset());

            const frecuencia = (creditoActual.frecuenciaPago || "Semanal").toLowerCase();
            const pagosProcesados = consolidarPagosIndividual(creditoActual.pagos || []);

            // Calcular inicio de renderizado y total de semanas a mostrar
            let semanaInicioReal = 1;
            let semanasRender = semanasTotales;
            
            if (req.query.semanaInicio && req.query.semanaInicio !== 'completa') {
                semanaInicioReal = parseInt(req.query.semanaInicio);
                if (req.query.semanaFin) {
                    semanasRender = Math.max(1, parseInt(req.query.semanaFin) - semanaInicioReal + 1);
                } else if (req.query.semanas) {
                    semanasRender = Math.max(1, parseInt(req.query.semanas));
                } else {
                    const restantes = Math.max(1, semanasTotales - semanaInicioReal + 1);
                    semanasRender = Math.min(8, restantes);
                }
            } else if (esSoloRefillFlag) {
                let inicioRefill = Math.floor(semanasTotales / 2) + 1;
                if (pagosProcesados && pagosProcesados.length > 0) {
                    const primerPagoNum = Number(pagosProcesados[0].numeroPago);
                    if (primerPagoNum > 0) inicioRefill = primerPagoNum;
                }
                semanaInicioReal = req.query.semanaInicioRefil ? parseInt(req.query.semanaInicioRefil) : inicioRefill;
                const restantes = Math.max(1, semanasTotales - semanaInicioReal + 1);
                semanasRender = Math.min(semanasTotales, restantes);
            } else {
                semanaInicioReal = 1;
                semanasRender = semanasTotales;
            }

            for (let i = 0; i < semanasRender; i++) {
                let nueva;
                let offsetPeriodos = (semanaInicioReal - 1) + i;

                if (frecuencia === 'mensual') {
                    const temp = new Date(baseDate);
                    const targetDay = temp.getDate();
                    temp.setMonth(temp.getMonth() + offsetPeriodos);
                    if (temp.getDate() !== targetDay) { temp.setDate(0); }
                    nueva = temp;
                } else if (frecuencia === 'quincenal') {
                    nueva = new Date(baseDate);
                    nueva.setDate(baseDate.getDate() + (offsetPeriodos * 15));
                } else if (frecuencia === 'bisemanal') {
                    nueva = new Date(baseDate);
                    nueva.setDate(baseDate.getDate() + (offsetPeriodos * 14));
                } else {
                    nueva = new Date(baseDate);
                    nueva.setDate(baseDate.getDate() + (offsetPeriodos * 7));
                }

                const fechaStr = nueva.toLocaleDateString('es-MX', {
                    day: '2-digit', month: '2-digit', year: 'numeric'
                });

                const semanaNumeroActual = semanaInicioReal + i;
                let pagoReal = 0;
                let foundPayment = false;
                let fechaPagoRealStr = '';
                let metodoPagoRealStr = '';
                if (pagosProcesados && pagosProcesados.length > 0) {
                    const pagosSemana = pagosProcesados.filter(p => p.numeroPago === semanaNumeroActual);
                    if (pagosSemana.length > 0) {
                        pagoReal = pagosSemana.reduce((acc, p) => {
                            let monto = (p.montoPagado !== undefined && p.montoPagado !== null && p.montoPagado > 0)
                                ? p.montoPagado
                                : (p.totalPagado || 0);
                            // Agregar montoSolidario solo si fue RECIBIDO (no si fue otorgado)
                            if (p.pagoSolidario && p.montoSolidario && p.quienPrestoSolidario) {
                                const prestoId = p.quienPrestoSolidario && p.quienPrestoSolidario.toString ? p.quienPrestoSolidario.toString() : String(p.quienPrestoSolidario);
                                let idEntidad = null;
                                if (creditoActual.miembro) {
                                    idEntidad = creditoActual.miembro._id ? creditoActual.miembro._id.toString() : String(creditoActual.miembro);
                                } else if (creditoActual.cliente) {
                                    idEntidad = creditoActual.cliente._id ? creditoActual.cliente._id.toString() : String(creditoActual.cliente);
                                }
                                if (idEntidad && prestoId !== idEntidad) {
                                    monto += p.montoSolidario || 0;
                                }
                            }
                            return acc + monto;
                        }, 0);
                        foundPayment = true;

                        try {
                            const ultimoPago = pagosSemana[pagosSemana.length - 1];
                            const rawFecha = ultimoPago ? (ultimoPago.fechaPago || ultimoPago.createdAt || ultimoPago.fecha) : null;
                            if (rawFecha) {
                                const dPago = new Date(rawFecha);
                                if (!isNaN(dPago.getTime())) {
                                    dPago.setMinutes(dPago.getMinutes() + dPago.getTimezoneOffset());
                                    fechaPagoRealStr = dPago.toLocaleDateString('es-MX', {
                                        day: '2-digit', month: '2-digit'
                                    });
                                }
                            }

                            const siglasList = [];
                            pagosSemana.forEach(p => {
                                const desgl = obtenerMetodosDesglosados(p);
                                desgl.siglas.forEach(s => {
                                    if (!siglasList.includes(s)) siglasList.push(s);
                                });
                            });
                            metodoPagoRealStr = siglasList.join('/');
                        } catch (errF) {
                            console.error('Error al formatear fechaPagoReal:', errF);
                        }
                    }
                }

                const saldoInicialRow = currentSaldo;
                // Si está llena, restar el pago real (si existe). Si no, restar el pactado para el plan teórico.
                const pagoParaSaldo = llena ? (foundPayment ? pagoReal : 0) : pagoPactado;
                const saldoFinalRow = saldoInicialRow - pagoParaSaldo > 0 ? saldoInicialRow - pagoParaSaldo : 0;

                fechas.push({
                    numero: semanaNumeroActual,
                    fecha: fechaStr,
                    fechaPagoReal: fechaPagoRealStr,
                    metodoPago: metodoPagoRealStr,
                    saldoInicial: saldoInicialRow,
                    pago: (llena && foundPayment) ? pagoReal : (llena ? 0 : pagoPactado),
                    saldoFinal: saldoFinalRow,
                    llena: llena,
                    found: foundPayment
                });

                currentSaldo = saldoFinalRow;
            }
            return fechas;
        };

        const maxSemanas = credito.semanas || 16;
        const fechaBasica = credito.fechaPrimerPago || new Date();
        const amortizaciones = generarCalendario(fechaBasica, maxSemanas, credito, esSoloRefill);

        let tablaAmortizacionTbody = '';
        amortizaciones.forEach(row => {
            const si = row.llena ? ((row.found || row.numero === 1) ? formatoMoneda(row.saldoInicial) : '') : '';
            const p = row.llena ? (row.found ? formatoMoneda(row.pago) : '') : '';
            const sf = row.llena ? (row.found ? formatoMoneda(row.saldoFinal) : '') : '';

            const siCell = si ? `<div class="align-money"><span>$</span> <span>${si}</span></div>` : '';
            
            let pContent = p;
            if (row.llena && row.found && row.fechaPagoReal) {
                const metodoInfo = row.metodoPago ? ` - ${row.metodoPago}` : '';
                pContent += ` <span style="font-size:8.5px; font-weight:bold; color:#1e3a8a;">(${row.fechaPagoReal}${metodoInfo})</span>`;
            }
            const pCell = p ? `<div class="align-money"><span>$</span> <span>${pContent}</span></div>` : '';

            const sfCell = sf ? `<div class="align-money"><span>$</span> <span>${sf}</span></div>` : '';

            tablaAmortizacionTbody += `
                <tr>
                    <td align="center" style="font-weight:bold;">${row.numero}</td>
                    <td align="center" style="font-weight:bold;">${row.fecha}</td>
                    <td style="font-weight:bold;">${siCell}</td>
                    <td style="font-weight:bold;">${pCell}</td>
                    <td style="font-weight:bold;">${sfCell}</td>
                </tr>
            `;
        });

        if (credito.garantiaAplicada) {
            tablaAmortizacionTbody += `
                <tr>
                    <td colspan="5" align="center" style="font-weight:bold; font-size:12px; color: #05152cffff; background-color: #dae1ffff; padding: 8px 0; border-top: 1px solid #000; text-transform: uppercase;">APLICACIÓN DE GARANTÍA</td>
                </tr>
            `;
        }

        // Obtener datos cabecera
        const nombreCliente = credito.cliente
            ? (credito.cliente.nombre + (credito.cliente.apellidos ? ` ${credito.cliente.apellidos}` : ""))
            : credito.miembro
                ? (credito.miembro.nombre + (credito.miembro.apellidos ? ` ${credito.miembro.apellidos}` : ""))
                : "N/A";

        const saldoInicial = formatoMoneda(credito.saldoTotal || 0);
        const garantia = formatoMoneda(credito.garantia || 0);
        const pagoPactado = formatoMoneda(credito.pagoPactado || 0);
        const tasaInteres = (credito.tasaInteres || 0);
        const periodoPago = (credito.frecuenciaPago || "SEMANAL").toUpperCase();

        let nombreGrupoDisplay = credito.grupoOpcional || credito.cliente?.grupo;
        if (nombreGrupoDisplay && /^[0-9a-fA-F]{24}$/.test(String(nombreGrupoDisplay).trim())) {
            const grupoAsociado = await Grupo.findById(String(nombreGrupoDisplay).trim());
            if (grupoAsociado) {
                nombreGrupoDisplay = grupoAsociado.nombre;
            }
        }

        const valorGrupo = (nombreGrupoDisplay && String(nombreGrupoDisplay).trim() !== '')
            ? String(nombreGrupoDisplay).trim().toUpperCase()
            : 'N/A';

        let grupoOpcionalHtml = `
            <div style="display: flex; margin-bottom: 5px;">
                <div style="width: 150px; text-align: right; padding-right: 10px;">GRUPO:</div>
                <div style="font-weight: normal; text-transform: uppercase;">${valorGrupo}</div>
            </div>`;

        let garantiaPredialHtml = '';
        if (credito.garantiaPredial && credito.garantiaPredial.trim() !== '') {
            garantiaPredialHtml = `
                <div style="display: flex; margin-bottom: 5px;">
                    <div style="width: 150px; text-align: right; padding-right: 10px;">GTIA PREDIAL/HIPOT:</div>
                    <div style="font-weight: normal; text-transform: uppercase;">${credito.garantiaPredial}</div>
                </div>`;
        }

        // Obtener el día de la semana de fechaBasica
        // const diasSemana = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
        // const baseDate = new Date(fechaBasica);
        // baseDate.setMinutes(baseDate.getMinutes() + baseDate.getTimezoneOffset());
        // const diaPago = diasSemana[baseDate.getDay()];
        // Obtener el día de pago (priorizando el registrado en el cliente)
        const diasSemana = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
        const baseDate = new Date(fechaBasica);
        baseDate.setMinutes(baseDate.getMinutes() + baseDate.getTimezoneOffset());
        
        let diaPago = "";
        
        // 1. Verificamos si el cliente tiene un día de pago registrado en BD
        if (credito.cliente && credito.cliente.diaPago) {
            const diaReg = credito.cliente.diaPago.toUpperCase().trim();
            
            // Si capturaron SOLO el número (ej: "18"), le agregamos " DE CADA MES"
            if (/^\d+$/.test(diaReg)) {
                diaPago = `${diaReg} DE CADA MES`;
            } else {
                // Si ya dice "18 DE CADA MES" o "LUNES", lo dejamos tal cual
                diaPago = diaReg;
            }
        } 
        // 2. Si no hay nada registrado, pero la frecuencia es Mensual, lo sacamos de la fecha
        else if ((credito.frecuenciaPago || "").toUpperCase() === 'MENSUAL') {
            diaPago = `${baseDate.getDate()} DE CADA MES`;
        } 
        // 3. Fallback: Si es semanal/quincenal y no hay registro, ponemos el día de la semana (ej. SÁBADO)
        else {
            diaPago = diasSemana[baseDate.getDay()];
        }
        
        const asesorStr = credito.cliente && credito.cliente.asesor
            ? (credito.cliente.asesor.nombre || credito.cliente.asesor.username || "________________")
            : "________________";
        const asesorNombre = asesorStr.toUpperCase();



        let estadoGrupoInd = req.query.estadoGrupo || credito.estadoGrupo;
        if (!estadoGrupoInd && creditosDelCiclo && creditosDelCiclo.length > 0) {
            estadoGrupoInd = creditosDelCiclo.find(c => c.estadoGrupo)?.estadoGrupo;
        }
        if (!estadoGrupoInd && ['CC', 'R', '8S'].includes(credito.tipoCredito)) {
            estadoGrupoInd = credito.tipoCredito;
        }
        if (!estadoGrupoInd && valorGrupo !== 'N/A') {
            try {
                const credGrupo = await Credito.findOne({
                    $or: [
                        { grupoOpcional: nombreGrupoDisplay },
                        { grupoOpcional: credito.grupoOpcional },
                        { grupoOpcional: credito.cliente?.grupo }
                    ],
                    estadoGrupo: { $exists: true, $ne: null }
                }).sort({ createdAt: -1 });
                if (credGrupo?.estadoGrupo) {
                    estadoGrupoInd = credGrupo.estadoGrupo;
                }
            } catch (e) {
                // ignore
            }
        }
        if (!estadoGrupoInd) {
            estadoGrupoInd = 'N/A';
        }
        const estadoGrupo = String(estadoGrupoInd).trim().toUpperCase();

        const templatePath = path.join(__dirname, '../templates/hojaControlIndividual.html');
        let htmlCompleto = fs.readFileSync(templatePath, 'utf8');

        htmlCompleto = htmlCompleto
            .replace('{{clienteNombre}}', nombreCliente)
            .replace('{{grupoOpcionalHtml}}', grupoOpcionalHtml)
            .replace('{{estadoGrupo}}', estadoGrupo)
            .replace('{{garantiaPredialHtml}}', garantiaPredialHtml)
            .replace('{{ciclo}}', ciclo)
            .replace('{{saldoInicial}}', saldoInicial)
            .replace('{{garantia}}', garantia)
            .replace('{{periodoPago}}', periodoPago)
            .replace('{{tasaInteres}}', tasaInteres)
            .replace('{{numPagos}}', amortizaciones.length)
            .replace('{{diaPago}}', diaPago)
            .replace('{{pagoPactado}}', pagoPactado)
            .replace('{{asesorNombre}}', asesorNombre)
            .replace('{{tablaAmortizacionTbody}}', tablaAmortizacionTbody);

        if (req.query.format === 'html') {
            return res.send(htmlCompleto);
        }

        const browser = await getBrowser();

        const page = await browser.newPage();
        await page.setContent(htmlCompleto, { waitUntil: "load" });

        const pdfBuffer = await page.pdf({
            format: "A4",
            landscape: false,
            printBackground: true,
            margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' }
        });

        await page.close();

        res.setHeader('Content-Type', 'application/pdf');
        const nombreArchivo = nombreCliente.replace(/\D/g, '').length === 0 ? nombreCliente.replace(/[^a-zA-Z0-9]/g, '_') : nombreCliente.replace(/\s+/g, '_');
        const estadoGrupoParam = (estadoGrupo && estadoGrupo !== 'N/A') ? `_${estadoGrupo}` : (req.query.estadoGrupo ? `_${req.query.estadoGrupo}` : '');
        const disposition = req.query.preview === 'true' ? 'inline' : 'attachment';
        res.setHeader('Content-Disposition', `${disposition}; filename="hoja-control-ind_${nombreArchivo}${estadoGrupoParam}_ciclo_${ciclo}.pdf"`);
        res.send(pdfBuffer);

    } catch (error) {
        console.error("Error generando hoja de control individual:", error);
        res.status(500).json({
            message: "Error interno",
            error: error.message
        });
    }
};

