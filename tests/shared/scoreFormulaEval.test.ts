import { describe, test, expect } from 'vitest';
import {
    splitRec,
} from '../../src/shared/scoreFormulaEval';

describe('calculation helpers', () => {
    describe('addition', () => {
        test('handles addition', () => {
            expect(splitRec('1 + 2')).toStrictEqual({
                type: 'binary',
                op: '+',
                left: {
                    type: "number",
                    value: 1
                },
                right: {
                    type: "number",
                    value: 2
                }
            })
            expect(splitRec('1 + 2 + 3 + 4')).toStrictEqual({
                type: 'binary',
                op: '+',
                left: {
                    type: "number",
                    value: 1
                },
                right: {
                    type: "binary",
                    op: '+',
                    left: {
                        type: 'number',
                        value: 2
                    },
                    right: {
                        type: 'binary',
                        op: '+',
                        left: {
                            type: 'number',
                            value: 3
                        },
                        right: {
                            type: 'number',
                            value: 4
                        }
                    }
                }
            })
        });
    })
    describe('multiplication', () => {
        test('handles multiplication', () => {
            expect(splitRec('1 * 2')).toStrictEqual({
                type: 'binary',
                op: '*',
                left: {
                    type: "number",
                    value: 1
                },
                right: {
                    type: "number",
                    value: 2
                }
            })
            expect(splitRec('1 * 2 * 3 * 4')).toStrictEqual({
                type: 'binary',
                op: '*',
                left: {
                    type: "number",
                    value: 1
                },
                right: {
                    type: "binary",
                    op: '*',
                    left: {
                        type: 'number',
                        value: 2
                    },
                    right: {
                        type: 'binary',
                        op: '*',
                        left: {
                            type: 'number',
                            value: 3
                        },
                        right: {
                            type: 'number',
                            value: 4
                        }
                    }
                }
            })
        });
    })
})