import { useEffect, useRef, useState } from 'react'
import { Parser, Store, DataFactory } from 'n3'
import { QueryEngine } from '@comunica/query-sparql'
import * as XLSX from 'xlsx'
import columnTranslations from './dictionaries/rdf_column_translations.json'
import encryptedQueries from './queries/queries.encrypted.json'
import './App.css'

const DEFAULT_QUERY_NAME = 'CWD Requirements VS1 & VS2 B6.rq'
const REQUIRED_FIRST_LINE = '# Requirements VS1 & VS2 => 6 (CW&D)'
const encryptedQueryOptions = (encryptedQueries?.queries || [])
  .map(({ name, label }) => ({
    name,
    label,
    content: '',
  }))
  .sort((a, b) => a.name.localeCompare(b.name))
const encryptedDefaultName =
  encryptedQueryOptions.find((option) => option.name === DEFAULT_QUERY_NAME)?.name ??
  encryptedQueryOptions[0]?.name ??
  ''
const OTL_MARK_NODES = '# --- OTL NODES ---'
const OTL_MARK_EDGES = '# --- OTL EDGES ---'
const columnTranslationMap = new Map(
  (columnTranslations?.mappings || [])
    .filter((item) => item && typeof item.original === 'string')
    .map((item) => [item.original.toLowerCase(), String(item.translation || '').trim()])
)

function App() {
  const [ttlText, setTtlText] = useState('')
  const [triples, setTriples] = useState([])
  const [prefixes, setPrefixes] = useState({})
  const [error, setError] = useState('')
  const [isParsing, setIsParsing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [sourceFileName, setSourceFileName] = useState('')
  const [store, setStore] = useState(null)
  const [queryOptions, setQueryOptions] = useState(encryptedQueryOptions)
  const [selectedQuery, setSelectedQuery] = useState(encryptedDefaultName)
  const [queryText, setQueryText] = useState('')
  const [queryRows, setQueryRows] = useState([])
  const [queryVars, setQueryVars] = useState([])
  const [queryError, setQueryError] = useState('')
  const [isQuerying, setIsQuerying] = useState(false)
  const [showPrefixes, setShowPrefixes] = useState(false)
  const [showTriples, setShowTriples] = useState(false)
  const [showQuery, setShowQuery] = useState(true)
  const [showLog, setShowLog] = useState(false)
  const [queryElapsed, setQueryElapsed] = useState(0)
  const [lastQueryDuration, setLastQueryDuration] = useState(null)
  const [lastQueryText, setLastQueryText] = useState('')
  const [visibleQueryRows, setVisibleQueryRows] = useState(200)
  const [visibleTriples, setVisibleTriples] = useState(200)
  const [querySearch, setQuerySearch] = useState('')
  const [logEntries, setLogEntries] = useState([])
  const [isOtlQuery, setIsOtlQuery] = useState(false)
  const [otlData, setOtlData] = useState(null)
  const [outputLocked, setOutputLocked] = useState(true)
  const [passwordInput, setPasswordInput] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const queryTimerRef = useRef(null)
  const highlightRef = useRef(null)
  const unlockAttemptRef = useRef(0)

  useEffect(() => {
    if (isQuerying) {
      const start = performance.now()
      setQueryElapsed(0)
      queryTimerRef.current = setInterval(() => {
        const seconds = (performance.now() - start) / 1000
        setQueryElapsed(seconds)
      }, 100)
      return () => {
        if (queryTimerRef.current) {
          clearInterval(queryTimerRef.current)
          queryTimerRef.current = null
        }
      }
    }

    if (queryTimerRef.current) {
      clearInterval(queryTimerRef.current)
      queryTimerRef.current = null
    }
    return undefined
  }, [isQuerying])

  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19)
    setLogEntries((prev) => [...prev.slice(-199), { message, timestamp, type }])
  }

  const applyParsedTurtle = (parsed) => {
    setTriples(parsed.triples)
    setPrefixes(parsed.prefixes)
    setStore(parsed.store)
  }

  const parseAndSetFromText = async (text, filename = '') => {
    setIsParsing(true)
    setError('')
    setQueryRows([])
    setQueryVars([])
    setQueryError('')
    setIsOtlQuery(false)
    setOtlData(null)
    addLog(filename ? `TTL geladen: ${filename} (${text.length} tekens).` : 'TTL geladen.')

    try {
      const parsed = await parseTurtleText(text)
      applyParsedTurtle(parsed)
      addLog(`Parse klaar: ${parsed.triples.length} triples.`)
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : String(parseError)
      setError(message)
      addLog(`Parse fout: ${message}`, 'error')
    } finally {
      setIsParsing(false)
    }
  }

  const readTtlFile = async (file) => {
    if (!file) return
    const text = await file.text()
    setSourceFileName(file.name)
    setTtlText(text)
    await parseAndSetFromText(text, file.name)
  }

  const handleFilePick = async (event) => {
    const file = event.target.files?.[0]
    await readTtlFile(file)
  }

  const handleDrop = async (event) => {
    event.preventDefault()
    setIsDragging(false)
    const file = event.dataTransfer.files?.[0]
    await readTtlFile(file)
  }

  const handleDragOver = (event) => {
    event.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const getExportPrefix = (name) => {
    if (isOtlQuery) return 'OTL'
    const prefixes = ['Ontologies', 'Spaces', 'Documents', 'Specifications', 'Activities']
    const safe = (name || '').trim()
    const found = prefixes.find((prefix) => safe.toLowerCase().startsWith(prefix.toLowerCase()))
    return found || 'RDF'
  }

  const escapeHtml = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')

  const highlightSparql = (text) => {
    const tokenRegex =
      /(#.*$)|("([^"\\]|\\.)*")|(<[^>]*>)|([?$][A-Za-z_][\w-]*)|(\b(?:SELECT|WHERE|PREFIX|OPTIONAL|DISTINCT|FILTER|GRAPH|UNION|VALUES|BASE|ASK|CONSTRUCT|DESCRIBE|ORDER|BY|LIMIT|OFFSET|GROUP|HAVING|a)\b)/gim
    let result = ''
    let lastIndex = 0
    for (const match of text.matchAll(tokenRegex)) {
      const index = match.index ?? 0
      result += escapeHtml(text.slice(lastIndex, index))
      const token = match[0]
      let className = ''
      if (match[1]) className = 'tok-comment'
      else if (match[2]) className = 'tok-string'
      else if (match[4]) className = 'tok-iri'
      else if (match[5]) className = 'tok-var'
      else if (match[6]) className = 'tok-kw'
      result += `<span class="${className}">${escapeHtml(token)}</span>`
      lastIndex = index + token.length
    }
    result += escapeHtml(text.slice(lastIndex))
    return result
  }

  const formatTimestamp = () => {
    const now = new Date()
    const pad = (value) => String(value).padStart(2, '0')
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(
      now.getHours()
    )}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  }

  const applyColumnTranslations = (headers) =>
    headers.map((header) => {
      const label = String(header ?? '')
      const translation = columnTranslationMap.get(label.toLowerCase()) || ''
      if (translation && !label.includes(`[${translation}]`)) {
        return `${label} [${translation}]`
      }
      return label
    })

  const exportBaseName = () => {
    const name = sourceFileName ? sourceFileName.replace(/\.[^.]+$/, '') : 'Resultaten'
    return name.replace(/[^A-Za-z0-9._-]+/g, '_')
  }

  const buildExportInfo = () => {
    const queryFirstLine = (lastQueryText || queryText || '').split('\n')[0] || ''
    const rowCount = queryRows.length
    const colCount = queryVars.length
    const nonEmptyCells = queryRows.reduce(
      (total, row) => total + row.filter((value) => String(value ?? '').trim() !== '').length,
      0
    )
    const notationStats = buildNotationStatsFor(queryVars, queryRows)
    return [
      ['Sleutel', 'Waarde'],
      ['Exportdatum', new Date().toISOString().replace('T', ' ').slice(0, 19)],
      ['Gebruiker', 'n/a'],
      ['PC naam', 'n/a'],
      ['Besturingssysteem', navigator.userAgent],
      ['TTL bestand', sourceFileName || ''],
      ['Aantal rijen', String(rowCount)],
      ['Aantal kolommen', String(colCount)],
      ['Niet lege cellen', String(nonEmptyCells)],
      ['Unieke rijen (Notation)', String(notationStats.count)],
      ['Notation kolommen', notationStats.columns || ''],
      ['Query (eerste regel)', queryFirstLine],
      ['Queryduur (s)', lastQueryDuration != null ? lastQueryDuration.toFixed(3) : ''],
    ]
  }

  const buildUniques = (headers, rows) => {
    const header = ['Kolom', 'Unieke waarden', 'Niet lege waarden']
    const detailRows = headers.map((variable, index) => {
      const values = rows.map((row) => row[index])
      const nonEmpty = values.filter((value) => String(value ?? '').trim() !== '')
      const unique = new Set(nonEmpty.map((value) => String(value)))
      return [headers[index], String(unique.size), String(nonEmpty.length)]
    })
    return [header, ...detailRows]
  }

  const buildNotationStatsFor = (headers, rows) => {
    const notationIndexes = headers
      .map((name, index) => ({ name, index }))
      .filter((item) => item.name.toLowerCase().includes('notation'))
    if (!notationIndexes.length) {
      return { count: 0, columns: '' }
    }

    const uniqueRows = new Set()
    for (const row of rows) {
      const key = notationIndexes
        .map((item) => String(row[item.index] ?? '').trim())
        .join('|')
      if (key.replace(/\|/g, '').trim() !== '') {
        uniqueRows.add(key)
      }
    }

    return {
      count: uniqueRows.size,
      columns: notationIndexes.map((item) => item.name).join(', '),
    }
  }

  const buildOtlExportInfo = (dataHeaders, dataRows) => {
    const nonEmptyCells = dataRows.reduce(
      (total, row) => total + row.filter((value) => String(value ?? '').trim() !== '').length,
      0
    )
    const notationStats = buildNotationStatsFor(dataHeaders, dataRows)
    return [
      ['Sleutel', 'Waarde'],
      ['Exportdatum', new Date().toISOString().replace('T', ' ').slice(0, 19)],
      ['Gebruiker', 'n/a'],
      ['PC naam', 'n/a'],
      ['Besturingssysteem', navigator.userAgent],
      ['TTL bestand', sourceFileName || ''],
      ['Aantal triples', String(triples.length)],
      ['Aantal kolommen (Data)', String(dataHeaders.length)],
      ['Niet lege cellen (Data)', String(nonEmptyCells)],
      ['Unieke rijen (Notation)', String(notationStats.count)],
      ['Notation kolommen', notationStats.columns || ''],
    ]
  }

  const downloadBlob = (blob, filename) => {
    if (window.navigator && window.navigator.msSaveOrOpenBlob) {
      window.navigator.msSaveOrOpenBlob(blob, filename)
      return
    }
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.rel = 'noopener'
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const downloadExcel = () => {
    if (!queryVars.length && !otlData) return
    if (outputLocked) return
    try {
      const workbook = XLSX.utils.book_new()
      const applyHeaderStyleAndFilter = (sheet) => {
        if (!sheet || !sheet['!ref']) return
        const range = XLSX.utils.decode_range(sheet['!ref'])
        sheet['!autofilter'] = { ref: sheet['!ref'] }
        for (let col = range.s.c; col <= range.e.c; col += 1) {
          const cellAddress = XLSX.utils.encode_cell({ r: range.s.r, c: col })
          const cell = sheet[cellAddress]
          if (!cell) continue
          cell.s = {
            ...(cell.s || {}),
            font: {
              ...(cell.s?.font || {}),
              bold: true,
            },
          }
        }
      }
      const autosizeColumns = (sheet, rows) => {
        if (!sheet) return
        const widths = []
        rows.forEach((row) => {
          row.forEach((value, index) => {
            const len = String(value ?? '').length
            widths[index] = Math.max(widths[index] || 10, Math.min(len + 2, 60))
          })
        })
        sheet['!cols'] = widths.map((wch) => ({ wch }))
      }

      if (isOtlQuery && otlData) {
        const pathsSheet = XLSX.utils.aoa_to_sheet([otlData.pathsHeaders, ...otlData.pathsRows])
        const nodesSheet = XLSX.utils.aoa_to_sheet([otlData.nodesHeaders, ...otlData.nodesRows])
        const edgesSheet = XLSX.utils.aoa_to_sheet([otlData.edgesHeaders, ...otlData.edgesRows])
        const dataSheet = XLSX.utils.aoa_to_sheet([otlData.dataHeaders, ...otlData.dataRows])
        const exportInfoSheet = XLSX.utils.aoa_to_sheet(
          buildOtlExportInfo(otlData.dataHeaders, otlData.dataRows)
        )
        const uniquesSheet = XLSX.utils.aoa_to_sheet(
          buildUniques(otlData.dataHeaders, otlData.dataRows)
        )

        applyHeaderStyleAndFilter(pathsSheet)
        applyHeaderStyleAndFilter(nodesSheet)
        applyHeaderStyleAndFilter(edgesSheet)
        applyHeaderStyleAndFilter(dataSheet)
        applyHeaderStyleAndFilter(exportInfoSheet)
        applyHeaderStyleAndFilter(uniquesSheet)

        autosizeColumns(pathsSheet, [otlData.pathsHeaders, ...otlData.pathsRows])
        autosizeColumns(nodesSheet, [otlData.nodesHeaders, ...otlData.nodesRows])
        autosizeColumns(edgesSheet, [otlData.edgesHeaders, ...otlData.edgesRows])
        autosizeColumns(dataSheet, [otlData.dataHeaders, ...otlData.dataRows])
        autosizeColumns(exportInfoSheet, buildOtlExportInfo(otlData.dataHeaders, otlData.dataRows))
        autosizeColumns(uniquesSheet, buildUniques(otlData.dataHeaders, otlData.dataRows))

        XLSX.utils.book_append_sheet(workbook, pathsSheet, 'Paths')
        XLSX.utils.book_append_sheet(workbook, nodesSheet, 'Nodes')
        XLSX.utils.book_append_sheet(workbook, edgesSheet, 'Edges')
        XLSX.utils.book_append_sheet(workbook, dataSheet, 'Data')
        XLSX.utils.book_append_sheet(workbook, exportInfoSheet, 'ExportInfo')
        XLSX.utils.book_append_sheet(workbook, uniquesSheet, 'Unieken')
        workbook.Workbook = { Views: [{ activeTab: 4 }] }
      } else {
        const translatedHeaders = applyColumnTranslations(queryVars)
        const dataSheet = XLSX.utils.aoa_to_sheet([translatedHeaders, ...queryRows])
        const exportInfoSheet = XLSX.utils.aoa_to_sheet(buildExportInfo())
        const uniquesSheet = XLSX.utils.aoa_to_sheet(buildUniques(translatedHeaders, queryRows))

        applyHeaderStyleAndFilter(dataSheet)
        applyHeaderStyleAndFilter(exportInfoSheet)
        applyHeaderStyleAndFilter(uniquesSheet)
        autosizeColumns(dataSheet, [translatedHeaders, ...queryRows])
        autosizeColumns(exportInfoSheet, buildExportInfo())
        autosizeColumns(uniquesSheet, buildUniques(translatedHeaders, queryRows))

        XLSX.utils.book_append_sheet(workbook, dataSheet, 'Data')
        XLSX.utils.book_append_sheet(workbook, exportInfoSheet, 'ExportInfo')
        XLSX.utils.book_append_sheet(workbook, uniquesSheet, 'Unieken')
        workbook.Workbook = { Views: [{ activeTab: 1 }] }
      }

      const filename = `${getExportPrefix(selectedQuery)}_${formatTimestamp()}_${exportBaseName()}.xlsx`
      XLSX.writeFile(workbook, filename, { compression: true })
      addLog(`Excel export: ${filename}`)
    } catch (downloadError) {
      const message =
        downloadError instanceof Error ? downloadError.message : String(downloadError)
      setQueryError(`Download mislukt: ${message}`)
      addLog(`Excel export fout: ${message}`, 'error')
    }
  }

  const downloadLog = () => {
    if (!logEntries.length) return
    const header = [
      'Export RDF Turtle Lab',
      `Datum: ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`,
      '',
    ].join('\n')
    const lines = logEntries.map((entry) => `[${entry.timestamp}] ${entry.message}`).join('\n')
    const filename = `log_${formatTimestamp()}.txt`
    try {
      const blob = new Blob([`${header}${lines}`], { type: 'text/plain;charset=utf-8;' })
      downloadBlob(blob, filename)
    } catch (downloadError) {
      const message =
        downloadError instanceof Error ? downloadError.message : String(downloadError)
      setQueryError(`Download mislukt: ${message}`)
      addLog(`Log export fout: ${message}`, 'error')
    }
  }

  const parseTurtleText = (text) =>
    new Promise((resolve, reject) => {
      const parser = new Parser()
      const nextStore = new Store()
      const nextTriples = []
      let detectedPrefixes = {}

      parser.parse(text, (parseError, quad, prefixMap) => {
        if (parseError) {
          reject(parseError)
          return
        }

        if (quad) {
          nextStore.addQuad(quad)
          nextTriples.push({
            subject: quad.subject.value,
            predicate: quad.predicate.value,
            object: quad.object.value,
            graph: quad.graph.value,
          })
        } else {
          detectedPrefixes = prefixMap || {}
          resolve({
            triples: nextTriples,
            prefixes: detectedPrefixes,
            store: nextStore,
          })
        }
      })
    })


  useEffect(() => {
    setVisibleTriples(200)
  }, [triples.length])

  useEffect(() => {
    setVisibleQueryRows(200)
  }, [queryRows.length, querySearch])

  const extractOtlQueries = (rawText) => {
    const txt = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const iNodes = txt.indexOf(OTL_MARK_NODES)
    const iEdges = txt.indexOf(OTL_MARK_EDGES)
    if (iNodes === -1 || iEdges === -1) return null

    let startNodes = iNodes
    let startEdges = iEdges
    if (startEdges < startNodes) {
      startNodes = iEdges
      startEdges = iNodes
    }

    const nodesBlock = txt.slice(startNodes + OTL_MARK_NODES.length).trim()
    const edgesBlock = txt.slice(startEdges + OTL_MARK_EDGES.length).trim()
    const nodesQuery = nodesBlock.split(OTL_MARK_EDGES)[0].trim()
    const edgesQuery = edgesBlock.split('# Tip:')[0].trim()
    if (!nodesQuery.includes('SELECT') || !nodesQuery.includes('WHERE')) return null
    if (!edgesQuery.includes('SELECT') || !edgesQuery.includes('WHERE')) return null
    return { nodesQuery, edgesQuery }
  }

  const extractSelectVariables = (queryText) => {
    const stripped = queryText
      .replace(/#.*$/gm, '')
      .replace(/\s+/g, ' ')
      .trim()
    const match = stripped.match(/select\s+(?:distinct|reduced)?\s*(.*?)\s+where/i)
    if (!match) return { vars: [], isWildcard: false }
    const selectClause = match[1] || ''
    if (selectClause.includes('*')) {
      return { vars: [], isWildcard: true }
    }
    const vars = []
    const seen = new Set()
    const varMatches = selectClause.matchAll(/[?$]([A-Za-z_][\w-]*)/g)
    for (const m of varMatches) {
      const name = m[1]
      if (!seen.has(name)) {
        seen.add(name)
        vars.push(name)
      }
    }
    return { vars, isWildcard: false }
  }

  const runBindingsQuery = async (query, activeStore) => {
    const engine = new QueryEngine()
    const bindingsStream = await engine.queryBindings(query, {
      sources: [activeStore],
    })
    const selectInfo = extractSelectVariables(query)
    let bindingVars = bindingsStream.variables ?? []
    if (bindingVars && typeof bindingVars.then === 'function') {
      bindingVars = await bindingVars
    }
    let bindingVarList = Array.isArray(bindingVars) ? bindingVars : []
    let variableNames = bindingVarList.map((variable) => variable.value)
    if (selectInfo.vars.length) {
      variableNames = selectInfo.vars
      bindingVarList = selectInfo.vars.map((name) => DataFactory.variable(name))
    }
    const rows = []

    for await (const binding of bindingsStream) {
      if (!bindingVarList.length && binding && typeof binding.keys === 'function') {
        bindingVarList = Array.from(binding.keys())
        variableNames = bindingVarList.map((variable) =>
          variable?.value ? variable.value : String(variable).replace(/^\?/, '')
        )
      }
      rows.push(
        bindingVarList.map((variable) => {
          const term = binding.get(variable)
          return term?.value ?? ''
        })
      )
    }

    return { vars: variableNames, rows }
  }

  const buildOtlData = (nodesResult, edgesResult) => {
    const getValue = (row, vars, name) => {
      const index = vars.findIndex((key) => key.toLowerCase() === name.toLowerCase())
      return index >= 0 ? row[index] : ''
    }

    const nodesIndex = {}
    nodesResult.rows.forEach((row) => {
      const obj = getValue(row, nodesResult.vars, 'obj')
      if (!obj) return
      const prefLabel = getValue(row, nodesResult.vars, 'prefLabel')
      const notation = getValue(row, nodesResult.vars, 'notation')
      const rdsMulti = getValue(row, nodesResult.vars, 'rdsMulti')
      const rdsSingle = getValue(row, nodesResult.vars, 'rdsSingle')
      const classes = getValue(row, nodesResult.vars, 'classes')
      nodesIndex[obj] = {
        id: obj,
        prefLabel,
        notation,
        rdsMulti,
        rdsSingle,
        classes: classes ? String(classes).split('|') : [],
      }
    })

    const nodesList = Object.values(nodesIndex)
    const sortKey = (node) =>
      String(node.prefLabel || node.notation || node.id || '').toLowerCase()
    nodesList.sort((a, b) => sortKey(a).localeCompare(sortKey(b)))

    const dataHeaders = [
      'id',
      'prefLabel',
      'notation',
      'rds_multiline',
      'rds_singleline',
      'otl_classes',
    ]
    const dataRows = nodesList.map((node) => [
      node.id,
      node.prefLabel,
      node.notation,
      node.rdsMulti,
      node.rdsSingle,
      node.classes.join('|'),
    ])

    const edgesHeaders = ['parent', 'child']
    const edgesRows = edgesResult.rows
      .map((row) => [
        getValue(row, edgesResult.vars, 'parent'),
        getValue(row, edgesResult.vars, 'child'),
      ])
      .filter((row) => row[0] && row[1])

    const adjacency = {}
    const indegree = {}
    Object.keys(nodesIndex).forEach((id) => {
      adjacency[id] = []
      indegree[id] = 0
    })
    edgesRows.forEach(([parent, child]) => {
      if (!nodesIndex[parent] || !nodesIndex[child]) return
      adjacency[parent].push(child)
      indegree[child] = (indegree[child] || 0) + 1
    })

    Object.keys(adjacency).forEach((id) => {
      adjacency[id].sort((a, b) => sortKey(nodesIndex[a]).localeCompare(sortKey(nodesIndex[b])))
    })

    const roots = Object.keys(indegree).filter((id) => indegree[id] === 0)
    const paths = []
    const walk = (id, path) => {
      const next = adjacency[id] || []
      if (!next.length) {
        paths.push([...path, id])
        return
      }
      next.forEach((child) => walk(child, [...path, id]))
    }
    const rootList = roots.length ? roots : Object.keys(nodesIndex)
    rootList.forEach((root) => walk(root, []))

    const maxDepth = paths.reduce((max, path) => Math.max(max, path.length), 0)
    const pathsHeaders = []
    for (let level = 1; level <= maxDepth; level += 1) {
      const prefix = `Level${level}_`
      pathsHeaders.push(
        `${prefix}id`,
        `${prefix}prefLabel`,
        `${prefix}notation`,
        `${prefix}rds_single`,
        `${prefix}rds_multi`
      )
    }

    const pathsRows = paths.map((path) => {
      const row = new Array(pathsHeaders.length).fill('')
      path.forEach((nodeId, idx) => {
        const node = nodesIndex[nodeId]
        const base = idx * 5
        row[base] = node?.id ?? ''
        row[base + 1] = node?.prefLabel ?? ''
        row[base + 2] = node?.notation ?? ''
        row[base + 3] = node?.rdsSingle ?? ''
        row[base + 4] = node?.rdsMulti ?? ''
      })
      return row
    })

    return {
      pathsHeaders,
      pathsRows,
      nodesHeaders: dataHeaders,
      nodesRows: dataRows,
      edgesHeaders,
      edgesRows,
      dataHeaders,
      dataRows,
    }
  }

  const sanitizeQueryText = (text) => {
    let txt = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const otl = extractOtlQueries(txt)
    if (otl?.nodesQuery) return otl.nodesQuery

    const lines = txt.split('\n')
    const out = []
    let seenQueryHeader = false
    let braceDepth = 0
    const headerRe = /^\s*(SELECT|ASK|CONSTRUCT|DESCRIBE)\b/i
    const newHeaderRe = /^\s*(PREFIX|BASE|SELECT|ASK|CONSTRUCT|DESCRIBE)\b/i

    for (const line of lines) {
      const ls = line.trimStart()
      if (seenQueryHeader && braceDepth <= 0 && newHeaderRe.test(ls)) {
        break
      }
      out.push(line)
      if (headerRe.test(ls) && !seenQueryHeader) {
        seenQueryHeader = true
      }
      if (seenQueryHeader) {
        braceDepth += (line.match(/{/g) || []).length
        braceDepth -= (line.match(/}/g) || []).length
      }
    }

    const cleaned = []
    let started = false
    const allowedStarts = ['PREFIX', 'BASE', 'SELECT', 'ASK', 'CONSTRUCT', 'DESCRIBE', '#']
    for (const line of out) {
      const s = line.trimStart()
      if (!started) {
        if (!s) {
          continue
        }
        if (allowedStarts.some((token) => s.startsWith(token))) {
          started = true
          cleaned.push(line)
        } else {
          cleaned.push(`# ${line}`)
        }
      } else {
        cleaned.push(line)
      }
    }

    return cleaned.join('\n').trim()
  }

  const runQuery = async () => {
    if (outputLocked) return
    if (!ttlText.trim()) return
    setIsQuerying(true)
    setQueryError('')
    setQueryRows([])
    setQueryVars([])
    setLastQueryDuration(null)
    setLastQueryText('')
    setIsOtlQuery(false)
    setOtlData(null)
    const start = performance.now()
    addLog('Query gestart.')

    try {
      let activeStore = store
      if (!activeStore) {
        setIsParsing(true)
        setError('')
        const parsed = await parseTurtleText(ttlText)
        setTriples(parsed.triples)
        setPrefixes(parsed.prefixes)
        setStore(parsed.store)
        activeStore = parsed.store
        addLog(`Parse voor query klaar: ${parsed.triples.length} triples.`)
      }

      const cleanedQuery = sanitizeQueryText(queryText)
      if (!cleanedQuery.trim()) {
        setQueryError('Query is leeg.')
        addLog('Query afgebroken: leeg.', 'error')
        return
      }
      const otlQueries = extractOtlQueries(queryText)
      if (otlQueries) {
        const nodesResult = await runBindingsQuery(otlQueries.nodesQuery, activeStore)
        const edgesResult = await runBindingsQuery(otlQueries.edgesQuery, activeStore)
        const otlResult = buildOtlData(nodesResult, edgesResult)
        setIsOtlQuery(true)
        setOtlData(otlResult)
        setQueryVars(otlResult.pathsHeaders)
        setQueryRows(otlResult.pathsRows)
        setLastQueryText(otlQueries.nodesQuery)
        setLastQueryDuration((performance.now() - start) / 1000)
        addLog(`OTL query klaar: ${otlResult.pathsRows.length} paths.`)
        await notifyQueryDone('Turtle-labs: Query klaar', `${otlResult.pathsRows.length} paths`)
        return
      }

      setLastQueryText(cleanedQuery)
      const result = await runBindingsQuery(cleanedQuery, activeStore)
      setQueryVars(result.vars)
      setQueryRows(result.rows)
      setLastQueryDuration((performance.now() - start) / 1000)
      addLog(`Query klaar: ${result.rows.length} rijen.`)
      await notifyQueryDone('Turtle-labs: Query klaar', `${result.rows.length} rijen`)
    } catch (queryError) {
      const message = queryError instanceof Error ? queryError.message : String(queryError)
      setQueryError(message)
      addLog(`Query fout: ${message}`, 'error')
    } finally {
      setIsQuerying(false)
      setIsParsing(false)
    }
  }

  const notifyQueryDone = async (title, body) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    const icon = new URL('./assets/logo_tbi.png', import.meta.url).href
    if (Notification.permission === 'granted') {
      new Notification(title, { body, icon })
      return
    }
    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission()
      if (permission === 'granted') {
        new Notification(title, { body, icon })
      }
    }
  }


  const notationStats =
    isOtlQuery && otlData
      ? buildNotationStatsFor(otlData.dataHeaders, otlData.dataRows)
      : buildNotationStatsFor(queryVars, queryRows)

  const base64ToBytes = (value) =>
    Uint8Array.from(atob(value), (char) => char.charCodeAt(0))

  const deriveKey = async (password, salt, iterations) => {
    const baseKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    )
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations,
        hash: 'SHA-256',
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    )
  }

  const decryptQuery = async (payload, password) => {
    const salt = base64ToBytes(payload.salt)
    const iv = base64ToBytes(payload.iv)
    const data = base64ToBytes(payload.data)
    const key = await deriveKey(password, salt, encryptedQueries.kdf.iterations)
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
    return new TextDecoder().decode(decrypted)
  }

  const handlePasswordSubmit = async (event) => {
    event.preventDefault()
    const trimmed = passwordInput.trim()
    if (!trimmed) {
      setPasswordError('Vul een wachtwoord in.')
      return
    }
    setPasswordError('')
    const attemptId = unlockAttemptRef.current + 1
    unlockAttemptRef.current = attemptId
    try {
      const defaultPayload =
        encryptedQueries.queries.find((query) => query.name === DEFAULT_QUERY_NAME) ??
        encryptedQueries.queries[0]
      if (!defaultPayload) {
        setPasswordError('Geen queries gevonden om te ontsleutelen.')
        return
      }
      const defaultText = await decryptQuery(defaultPayload, trimmed)
      if (attemptId !== unlockAttemptRef.current) return
      const firstLine = defaultText.split('\n')[0] || ''
      if (!firstLine.includes(REQUIRED_FIRST_LINE)) {
        setPasswordError('Wachtwoord klopt niet.')
        return
      }
      const decrypted = await Promise.all(
        encryptedQueries.queries.map(async (query) => ({
          ...query,
          content: await decryptQuery(query, trimmed),
        }))
      )
      if (attemptId !== unlockAttemptRef.current) return
      const nextOptions = decrypted
        .map(({ name, label, content }) => ({ name, label, content }))
        .sort((a, b) => a.name.localeCompare(b.name))
      const defaultName =
        nextOptions.find((option) => option.name === DEFAULT_QUERY_NAME)?.name ??
        nextOptions[0]?.name ??
        ''
      const defaultTextResolved =
        nextOptions.find((option) => option.name === defaultName)?.content ?? ''
      setQueryOptions(nextOptions)
      setSelectedQuery(defaultName)
      setQueryText(defaultTextResolved)
      setOutputLocked(false)
      setPasswordInput('')
      setPasswordError('')
    } catch (unlockError) {
      if (attemptId !== unlockAttemptRef.current) return
      setPasswordError('Wachtwoord klopt niet.')
    }
  }

  const togglePanel = (panel) => {
    if (panel === 'query') {
      setShowQuery((prev) => !prev)
      setShowPrefixes(false)
      setShowTriples(false)
      setShowLog(false)
      return
    }
    if (panel === 'prefixes') {
      setShowPrefixes((prev) => !prev)
      setShowQuery(false)
      setShowTriples(false)
      setShowLog(false)
      return
    }
    if (panel === 'triples') {
      setShowTriples((prev) => !prev)
      setShowQuery(false)
      setShowPrefixes(false)
      setShowLog(false)
      return
    }
    if (panel === 'log') {
      setShowLog((prev) => !prev)
      setShowQuery(false)
      setShowPrefixes(false)
      setShowTriples(false)
    }
  }

  const handleInfiniteScroll = (event, total, setter) => {
    if (!total) return
    const target = event.currentTarget
    if (!target) return
    const nearBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 40
    if (nearBottom) {
      setter((prev) => Math.min(prev + 200, total))
    }
  }

  const handleQueryScroll = (event) => {
    const target = event.currentTarget
    if (!highlightRef.current) return
    highlightRef.current.scrollTop = target.scrollTop
    highlightRef.current.scrollLeft = target.scrollLeft
  }

  const normalizedSearch = querySearch.trim().toLowerCase()
  const filteredQueryRows = normalizedSearch
    ? queryRows.filter((row) =>
        row.some((value) => String(value ?? '').toLowerCase().includes(normalizedSearch))
      )
    : queryRows

  return (
    <>
      <div className="app">
        <header className="hero">
          <div>
            <p className="eyebrow">RDF Turtle Lab</p>
            <h1>Lees Turtle (.ttl) en exporteer</h1>
            <p className="subtitle">
              Upload of sleep een .ttl en parse direct naar RDF-triples.
            </p>
          </div>
          <div className="actions" />
        </header>

        <section className="panel">
          <div className="panel-header">
            <h2>Input</h2>
          </div>
          <div
            className={`upload ${isDragging ? 'dragging' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <label className="file">
              <input type="file" accept=".ttl,.txt" onChange={handleFilePick} />
              Upload .ttl
            </label>
            <span className="hint">Of sleep een .ttl hierheen.</span>
          </div>
          <p className="upload-status">
            {sourceFileName
              ? `Inhoud geladen uit ${sourceFileName} (${ttlText.length} tekens)`
              : 'Nog geen .ttl bestand geselecteerd.'}
          </p>
        </section>

        <section className="panel results">
          <div className={`output-lock ${outputLocked ? 'locked' : ''}`}>
            <div className="output-lock-content">
              <div className="panel-header">
                <h2>Output</h2>
                <div className="panel-actions">
                  {!outputLocked ? (
                    <button className="ghost" type="button" onClick={() => setOutputLocked(true)}>
                      Vergrendel output
                    </button>
                  ) : null}
                </div>
              </div>

              {error ? <div className="error">Parse fout: {error}</div> : null}

              <div className="output-cards">
                <div className="stat-card">
                  <p className="stat-label">Triples</p>
                  <p className="stat-value">{triples.length}</p>
                  <p className="stat-note">
                    {Object.keys(prefixes).length
                      ? `${Object.keys(prefixes).length} prefixes`
                      : 'Geen prefixes'}
                  </p>
                </div>
                <div className="stat-card">
                  <p className="stat-label">Query resultaten</p>
                  <p className="stat-value">{queryRows.length}</p>
                  <p className="stat-note">
                    {queryVars.length ? `${queryVars.length} kolommen` : 'Nog geen query'}
                  </p>
                </div>
                <div className="stat-card">
                  <p className="stat-label">Uniek (notation)</p>
                  <p className="stat-value">{notationStats.count}</p>
                  <p className="stat-note">{notationStats.columns || 'Geen notation kolommen'}</p>
                </div>
              </div>

              <div className="toggle-row">
                <button
                  className="ghost toggle"
                  type="button"
                  onClick={() => togglePanel('query')}
                >
                  {showQuery ? 'Hide query' : 'Show query'}
                </button>
                <button
                  className="ghost toggle"
                  type="button"
                  onClick={() => togglePanel('prefixes')}
                  disabled={!Object.keys(prefixes).length}
                >
                  {showPrefixes ? 'Hide prefixes' : 'Show prefixes'}
                </button>
                <button
                  className="ghost toggle"
                  type="button"
                  onClick={() => togglePanel('triples')}
                  disabled={!triples.length}
                >
                  {showTriples ? 'Hide triples' : 'Show triples'}
                </button>
                <button className="ghost toggle" type="button" onClick={() => togglePanel('log')}>
                  {showLog ? 'Hide log' : 'Show log'}
                </button>
              </div>
              <div className={`toggle-panel query-panel ${showQuery ? 'open' : ''}`}>
                <div className="query">
                  <div className="query-controls">
                    <label htmlFor="querySelect">Query</label>
                    <select
                      id="querySelect"
                      value={selectedQuery}
                      onChange={(event) => {
                        const nextName = event.target.value
                        setSelectedQuery(nextName)
                        const nextQuery =
                          queryOptions.find((option) => option.name === nextName)?.content ?? ''
                        setQueryText(nextQuery)
                      }}
                      disabled={!queryOptions.length}
                    >
                      {queryOptions.map((option) => (
                        <option key={option.name} value={option.name}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <button
                      className="ghost"
                      onClick={runQuery}
                      disabled={!ttlText.trim() || isQuerying || outputLocked}
                    >
                      {isQuerying ? (
                        <span className="button-inline">
                          <span className="spinner" aria-hidden="true" />
                          Query draait... {queryElapsed.toFixed(1)}s
                        </span>
                      ) : (
                        'Run query'
                      )}
                    </button>
                    <button
                      className="primary"
                      onClick={downloadExcel}
                      disabled={!queryVars.length || isQuerying || outputLocked}
                    >
                      Download Excel
                    </button>
                  </div>
                  <div className="query-editor-wrap">
                    <pre
                      ref={highlightRef}
                      className="query-highlight"
                      aria-hidden="true"
                      dangerouslySetInnerHTML={{ __html: `${highlightSparql(queryText)}\n` }}
                    />
                    <textarea
                      className="query-editor"
                      value={queryText}
                      onChange={(event) => setQueryText(event.target.value)}
                      onScroll={handleQueryScroll}
                      placeholder="Selecteer een query uit de lijst..."
                      rows={10}
                    />
                  </div>
                  <div className="query-search">
                    <input
                      type="search"
                      value={querySearch}
                      onChange={(event) => setQuerySearch(event.target.value)}
                      placeholder="Zoek in resultaten..."
                      disabled={!queryRows.length}
                    />
                    {querySearch ? (
                      <button className="ghost" type="button" onClick={() => setQuerySearch('')}>
                        Wis
                      </button>
                    ) : null}
                  </div>
                  {queryError ? <div className="error">Query fout: {queryError}</div> : null}
                  <div className="output-section">
                    <div className="output-header">
                      <h3>{isOtlQuery ? 'Paths' : 'Query resultaat'}</h3>
                      <span className="meta">
                        {queryVars.length
                          ? `${Math.min(visibleQueryRows, filteredQueryRows.length)} van ${
                              filteredQueryRows.length
                            } rijen`
                          : 'Nog geen query resultaat'}
                      </span>
                    </div>
                    <div
                      className="query-results"
                      onScroll={(event) =>
                        handleInfiniteScroll(event, filteredQueryRows.length, setVisibleQueryRows)
                      }
                    >
                      {queryVars.length ? (
                        <table>
                          <thead>
                            <tr>
                              {queryVars.map((variable) => (
                                <th key={variable}>{variable}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {filteredQueryRows.length ? (
                              filteredQueryRows.slice(0, visibleQueryRows).map((row, rowIndex) => (
                                <tr key={`row-${rowIndex}`}>
                                  {row.map((value, colIndex) => (
                                    <td key={`cell-${rowIndex}-${colIndex}`}>{value}</td>
                                  ))}
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={queryVars.length} className="empty-cell">
                                  Geen resultaten voor deze query.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      ) : (
                        <p className="empty">Selecteer een query en voer hem uit.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className={`prefixes-panel toggle-panel ${showPrefixes ? 'open' : ''}`}>
                {Object.keys(prefixes).length ? (
                  <div className="prefixes">
                    <h3>Prefixes</h3>
                    <ul>
                      {Object.entries(prefixes).map(([prefix, iri]) => (
                        <li key={prefix}>
                          <span>{prefix || '(default)'}</span>
                          <code>{iri}</code>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="empty">Geen prefixes gevonden.</p>
                )}
              </div>

              <div className={`triples-panel toggle-panel ${showTriples ? 'open' : ''}`}>
                <div className="output-header">
                  <h3>Triples</h3>
                  <span className="meta">
                    {triples.length
                      ? `${Math.min(visibleTriples, triples.length)} van ${triples.length} triples`
                      : 'Nog geen triples'}
                  </span>
                </div>
                <div
                  className="triples"
                  onScroll={(event) =>
                    handleInfiniteScroll(event, triples.length, setVisibleTriples)
                  }
                >
                  {triples.length ? (
                    <table>
                      <thead>
                        <tr>
                          <th>Subject</th>
                          <th>Predicate</th>
                          <th>Object</th>
                        </tr>
                      </thead>
                      <tbody>
                        {triples.slice(0, visibleTriples).map((triple, index) => (
                          <tr key={`${triple.subject}-${triple.predicate}-${index}`}>
                            <td>{triple.subject}</td>
                            <td>{triple.predicate}</td>
                            <td>{triple.object}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="empty">Parse een Turtle-bestand om triples te zien.</p>
                  )}
                </div>
              </div>
              <div className={`toggle-panel log-panel ${showLog ? 'open' : ''}`}>
                <div className="output-header">
                  <h3>Log</h3>
                  <div className="panel-actions">
                    <button
                      className="primary"
                      type="button"
                      onClick={downloadLog}
                      disabled={!logEntries.length}
                    >
                      Download log
                    </button>
                  </div>
                </div>
                <div className="log-entries log-latest-first">
                  {logEntries.length ? (
                    <ul>
                      {logEntries.map((entry, index) => (
                        <li key={`${entry.timestamp}-${index}`} className={entry.type || 'info'}>
                          <span className="log-time">{entry.timestamp}</span>
                          <span className="log-msg">{entry.message}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="empty">Nog geen log regels.</p>
                  )}
                </div>
              </div>
            </div>
            {outputLocked ? (
              <div className="output-lock-overlay">
                <div className="output-lock-card">
                  <p className="stat-label">Beveiligde output</p>
                  <h3>Output is vergrendeld</h3>
                  <p className="meta">
                    Vul het wachtwoord in om de resultaten te bekijken.
                  </p>
                  <form className="output-lock-form" onSubmit={handlePasswordSubmit}>
                    <input
                      type="password"
                      value={passwordInput}
                      onChange={(event) => setPasswordInput(event.target.value)}
                      placeholder="Wachtwoord"
                      autoComplete="current-password"
                    />
                    <div className="output-lock-actions">
                      <button className="primary" type="submit">
                        Ontgrendel
                      </button>
                    </div>
                  </form>
                  {passwordError ? <div className="error">{passwordError}</div> : null}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </>
  )
}

export default App
