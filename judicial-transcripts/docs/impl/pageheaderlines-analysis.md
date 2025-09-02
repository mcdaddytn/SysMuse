# PageHeaderLines Analysis Report
**Date**: 2025-09-02

## Configuration Summary

### Default Setting
**pageHeaderLines=1** (most common configuration)

## Confirmed Configurations (Trials 01-40)

### pageHeaderLines=1 (Default)
- 01 Genband
- 02 Contentguard  
- 03 Core Wireless
- 06 Simpleair
- 07 Usa Re Joshua Harman V Trinity Industries
- 10 Metaswitch Genband 2016
- 11 Dataquill Limited V. Zte Corporation Et Al
- 14 Optis Wireless Technology V. Apple Inc
- 15 Optis Wireless Technology V. Huawei
- 16 Saint Lawrence V. Motorola
- 17 Wi-Lan V. Apple,
- 18 Wi-Lan V. Htc
- 19 Alfonso Cioffi Et Al V. Google
- 20 Biscotti Inc. V. Microsoft Corp
- 21 Cassidian V Microdata
- 22 Core Wireless V. Apple
- 23 Flexuspine V. Globus Medical (INVALID - inverted header)
- 24 Fractus V. T-Mobile Us
- 29 Intellectual Ventures V. T Mobile
- 30 Kaist Ip Us Llc V. Samsung
- 31 Mobile Tele V. Htc
- 35 Rembrandt V Samsung
- 37 Simpleair V. Google
- 39 Tqp Development Llc Vs V. 1-800-Flowers

### pageHeaderLines=2
- 05 Personalized Media v Zynga
- 12 Gree Supercell
- 28 Implicit V Netscout
- 32 Netlist V Samsung
- 34 Personalized Media V Google
- 36 Salazar V. Htc
- 40 USAA V Wells

### pageHeaderLines=3
- 04 Intellectual Ventures
- 33 Personal Audio V. Cbs

## Sampled Configurations (Trials 41+)

Based on header analysis of first transcript file:

### Likely pageHeaderLines=2
- 42 Vocalife Amazon (Case header + page number on line 2)
- 49 Luvncare V Royal King (Case header + "1" on line 2)  
- 55 SSL V Citrix (Case header + "1" on line 2)
- 61 Nichia Corporation V. Everlight Electronics
- 63 Solas Oled Ltd. V. Samsung

### Likely pageHeaderLines=1 (Default)
- 43 Whirlpool V. Tst
- 44 Beneficial V. Advance
- 45 Chrimar V. Dell
- 46 Droplets V. Ebay
- 48 Intellectual V Great West
- 51 Packet Sandvine
- 52 Personalized Apple
- 59 Gree V. Supercell
- 62 Simpleair V. Google 582
- 65 Ticketnetwork V. Ceats
- 67 Gonzalez V. New Life
- 71 Hinson Et Al V. Dorel
- 73 Tq Delta, Llc V. Commscope
- 75 Garrett V Wood County
- 83 Koninklijke
- 85 Navico V. Garmin
- 86 Ollnova
- 95 Lake Cherokee
- 101 Netlist, Inc. V. Samsung
- 103 Smartflash
- 106 Chrimar Systems V. Aerohive

## Invalid Trials

These trials have structural issues preventing normal parsing:

1. **23 Flexuspine V. Globus Medical** - Inverted two-page header
2. **50 Packet Netscout / 50 Packet** - Duplicate/unclear structure
3. **68 Contentguard Holdings, Inc. V. Google** - Page structure broken (1 page per session)
4. **72 Taylor V Turner** - Malformed PDF conversion, irregular page boundaries

## Header Patterns Identified

### Pattern 1: Standard Case Header
```
Case 2:XX-cv-XXXXX-JRG Document XXX Filed XX/XX/XX Page X of XXX PageID #: XXXXX
```
- Single line header → pageHeaderLines=1

### Pattern 2: Case Header + Page Number
```
Case 2:XX-cv-XXXXX-JRG Document XXX Filed XX/XX/XX Page X of XXX PageID #: XXXXX
1
```
- Case header + standalone page number → pageHeaderLines=2

### Pattern 3: Case Header + Page Number + Blank
```
Case 2:XX-cv-XXXXX-JRG Document XXX Filed XX/XX/XX Page X of XXX PageID #: XXXXX
1
[blank line]
```
- Case header + page number + blank → pageHeaderLines=3

## Recommendations

1. **Set default to pageHeaderLines=1** for all trials initially
2. **Update specific trials** based on confirmed analysis
3. **Test each trial** during Phase 1 parsing to verify header extraction
4. **Check Page.headerText** to validate configuration
5. **Document edge cases** like trial 23's inverted header

## Next Steps

1. Apply pageHeaderLines=2 to trials: 42, 49, 55, 61, 63
2. Verify remaining trials with default pageHeaderLines=1
3. Create automated header detection logic for future trials
4. Handle special cases like trial 23 separately