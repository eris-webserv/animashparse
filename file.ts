// @ts-nocheck - SHUT THE FU-

import { Buffer } from "node:buffer";

function writeString(v: string): Buffer {
    const raw = Buffer.from(v, 'utf16le');
    const lenBuf = Buffer.alloc(2);
    lenBuf.writeUInt16LE(raw.length);
    return Buffer.concat([lenBuf, raw]);
}

function readString(data: Buffer, offset: number): [string, number] {
    const length = data.readUInt16LE(offset);
    const str = data.toString('utf16le', offset + 2, offset + 2 + length);
    return [str, length + 2];
}

type ValueType = 'string' | 'short' | 'int';
type SegmentValue = { type: ValueType; value: string | number };
type SegmentEntry = {
    key: string;
    type: ValueType;
    value: string | number;
};

type FormattedSegment = {
    shorts: SegmentEntry[];
    strings: SegmentEntry[];
    ints: SegmentEntry[];
};

type FileJson = {
    version: number;
    segments: Record<string, FormattedSegment>;
};

export class File {
    version: number = 3;
    segments: Map<string, Record<string, SegmentValue>>;

    constructor(value: Buffer | null = null) {
        this.segments = new Map();
        if (value !== null) {
            this.fromBytes(value);
        }
    }

    toBytes(): Buffer {
        let out = Buffer.alloc(1);
        out.writeUInt8(this.version);
        const segSizeBuf = Buffer.alloc(2);
        segSizeBuf.writeUInt16LE(this.segments.size);
        out = Buffer.concat([out, segSizeBuf]);
        
        for (const [k, segment] of this.segments.entries()) {
            out = Buffer.concat([out, writeString(k), Buffer.from([1])]);
            
            const shorts = Object.entries(segment).filter(([, v]) => v.type === 'short');
            const strings = Object.entries(segment).filter(([, v]) => v.type === 'string');
            const ints = Object.entries(segment).filter(([, v]) => v.type === 'int');

            let countBuf = Buffer.alloc(4);
            countBuf.writeUInt32LE(shorts.length);
            out = Buffer.concat([out, countBuf]);
            
            for (const [k, v] of shorts) {
                out = Buffer.concat([out, writeString(k)]);
                const valBuf = Buffer.alloc(2);
                valBuf.writeInt16LE(v.value as number);
                out = Buffer.concat([out, valBuf]);
            }

            countBuf = Buffer.alloc(4);
            countBuf.writeUInt32LE(strings.length);
            out = Buffer.concat([out, countBuf]);
            
            for (const [k, v] of strings) {
                out = Buffer.concat([
                    out,
                    writeString(k),
                    writeString(v.value as string)
                ]);
            }

            countBuf = Buffer.alloc(4);
            countBuf.writeUInt32LE(ints.length);
            out = Buffer.concat([out, countBuf]);
            
            for (const [k, v] of ints) {
                out = Buffer.concat([out, writeString(k)]);
                const valBuf = Buffer.alloc(4);
                valBuf.writeInt32LE(v.value as number);
                out = Buffer.concat([out, valBuf]);
            }
        }
        return out;
    }

    fromBytes(value: Buffer): void {
        let offset = 0;
        this.version = value.readUInt8(offset);
        offset += 1;
        const nSegments = value.readUInt16LE(offset);
        offset += 2;
        
        for (let i = 0; i < nSegments; i++) {
            const [segName, segNameLen] = readString(value, offset);
            offset += segNameLen;
            
            this.segments.set(segName, {});
            const random1 = value.readUInt8(offset);
            offset += 1;

            const nShorts = value.readUInt32LE(offset);
            offset += 4;
            for (let j = 0; j < nShorts; j++) {
                const [vname, vnameLen] = readString(value, offset);
                offset += vnameLen;
                const shortVal = value.readInt16LE(offset);
                offset += 2;
                this.segments.get(segName)![vname] = { type: 'short', value: shortVal };
            }

            const nStrings = value.readUInt32LE(offset);
            offset += 4;
            for (let j = 0; j < nStrings; j++) {
                const [vname, vnameLen] = readString(value, offset);
                offset += vnameLen;
                const [strVal, strValLen] = readString(value, offset);
                offset += strValLen;
                this.segments.get(segName)![vname] = { type: 'string', value: strVal };
            }

            const nInts = value.readUInt32LE(offset);
            offset += 4;
            for (let j = 0; j < nInts; j++) {
                const [vname, vnameLen] = readString(value, offset);
                offset += vnameLen;
                const intVal = value.readInt32LE(offset);
                offset += 4;
                this.segments.get(segName)![vname] = { type: 'int', value: intVal };
            }
        }
    }

    toJSON(): FileJson {
        return {
            version: this.version,
            segments: Object.fromEntries(
                Array.from(this.segments.entries()).map(([segmentKey, segment]) => {
                    // Group entries by their type while preserving original ordering
                    const formatted: FormattedSegment = {
                        shorts: [],
                        strings: [],
                        ints: []
                    };

                    // Preserve ordering by processing entries in their original order
                    for (const [key, value] of Object.entries(segment)) {
                        formatted[`${value.type}s`].push({
                            key,
                            type: value.type,
                            value: value.value
                        });
                    }

                    return [segmentKey, formatted];
                })
            )
        };
    }

    fromJSON(data: FileJson): void {
        if (typeof data !== 'object' || data === null) {
            throw new TypeError("Data must be an object!");
        }

        this.version = data.version;
        this.segments.clear();

        for (const [segmentKey, segment] of Object.entries(data.segments)) {
            const newSegment: Record<string, SegmentValue> = {};
            
            // Process each type group in the correct order to maintain file structure
            for (const entry of segment.shorts) {
                newSegment[entry.key] = { type: entry.type, value: entry.value };
            }
            for (const entry of segment.strings) {
                newSegment[entry.key] = { type: entry.type, value: entry.value };
            }
            for (const entry of segment.ints) {
                newSegment[entry.key] = { type: entry.type, value: entry.value };
            }

            this.segments.set(segmentKey, newSegment);
        }
    }
}

