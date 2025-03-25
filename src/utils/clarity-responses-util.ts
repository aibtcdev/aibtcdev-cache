import { ClarityType, ClarityValue, cvToValue, ListCV, ResponseErrorCV, ResponseOkCV, SomeCV, TupleCV } from '@stacks/transactions';

/**
 * Recursively decodes Clarity values into JavaScript objects
 * 
 * @param value - The Clarity value to decode
 * @param strictJsonCompat - If true, ensures values are JSON compatible
 * @param preserveContainers - If true, preserves container types in the output
 * @returns JavaScript representation of the Clarity value
 */
export function decodeClarityValues(value: ClarityValue, strictJsonCompat = false, preserveContainers = false): any {
	switch (value.type) {
		case ClarityType.Tuple:
			return decodeTupleRecursively(value as TupleCV, strictJsonCompat, preserveContainers);
		case ClarityType.List:
			return decodeListRecursively(value as ListCV, strictJsonCompat, preserveContainers);
		case ClarityType.OptionalSome:
			if (preserveContainers) {
				return {
					type: ClarityType.OptionalSome,
					value: decodeClarityValues((value as SomeCV).value, strictJsonCompat, preserveContainers),
				};
			}
			return decodeClarityValues((value as SomeCV).value, strictJsonCompat, preserveContainers);
		case ClarityType.ResponseOk:
			if (preserveContainers) {
				return {
					type: ClarityType.ResponseOk,
					value: decodeClarityValues((value as ResponseOkCV).value, strictJsonCompat, preserveContainers),
				};
			}
			return decodeClarityValues((value as ResponseOkCV).value, strictJsonCompat, preserveContainers);
		case ClarityType.ResponseErr:
			if (preserveContainers) {
				return {
					type: ClarityType.ResponseErr,
					value: decodeClarityValues((value as ResponseErrorCV).value, strictJsonCompat, preserveContainers),
				};
			}
			return decodeClarityValues((value as ResponseErrorCV).value, strictJsonCompat, preserveContainers);
		default:
			return cvToValue(value, strictJsonCompat);
	}
}

/**
 * Recursively decodes a Clarity tuple into a JavaScript object
 * 
 * @param tuple - The Clarity tuple to decode
 * @param strictJsonCompat - If true, ensures values are JSON compatible
 * @param preserveContainers - If true, preserves container types in the output
 * @returns JavaScript object representation of the tuple
 */
export function decodeTupleRecursively(tuple: TupleCV, strictJsonCompat = false, preserveContainers = false): any {
	return Object.fromEntries(
		Object.entries(tuple.value).map(([key, value]) => {
			return [key, decodeClarityValues(value, strictJsonCompat, preserveContainers)];
		})
	);
}

/**
 * Recursively decodes a Clarity list into a JavaScript array
 * 
 * @param list - The Clarity list to decode
 * @param strictJsonCompat - If true, ensures values are JSON compatible
 * @param preserveContainers - If true, preserves container types in the output
 * @returns JavaScript array representation of the list
 */
export function decodeListRecursively(list: ListCV, strictJsonCompat = false, preserveContainers = false): any[] {
	return list.value.map((value) => {
		return decodeClarityValues(value, strictJsonCompat, preserveContainers);
	});
}
