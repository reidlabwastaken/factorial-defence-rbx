import type { Components } from "@flamework/components";
import type { ItemComponent } from "ReplicatedStorage/Components/Item";
import type { UserComponent } from "ReplicatedStorage/Components/User";
import type { ItemMovementError } from "ReplicatedStorage/Enums/Errors/ItemMovementError";
import type { ItemMovementService } from "./ItemMovementService";
import { CollectionService, HttpService, Workspace } from "@rbxts/services";
import { getSymmetricEnumMembers } from "ReplicatedStorage/Utility/GetEnumMembers";
import { Dependency, Service } from "@flamework/core";
import { PricingExchangeType } from "ReplicatedStorage/Enums/PricingExchangeType";
import { Option, Result } from "@rbxts/rust-classes";
import { CollectionTag } from "ReplicatedStorage/Enums/CollectionTag";
import { GenericError } from "ReplicatedStorage/Networking/GenericError";
import { ItemRegistry } from "ReplicatedStorage/Items/ItemRegistry";
import { Currency } from "ReplicatedStorage/Enums/Currency";

@Service()
export class ItemService {
	constructor () {
		for (const [key, register] of pairs(ItemRegistry)) {
			const model = register.model;
			assert(model, `Item model for item with id '${key}' does not exist!`);
			assert(model.PrimaryPart, `Item model ${model.Name} has no primary part!`);
			model.GetDescendants().filter((descendant): descendant is BasePart => descendant.IsA("BasePart")).forEach((descendant) => { descendant.Anchored = true; });
			model.PivotTo(new CFrame(Vector3.zero));
		}
	}

	/**
	 * Attempts to create the provided item at the provided location, withdrawing the price of the item from the provided user's balance.
	 */
	public PurchaseItem (user: UserComponent, registerUUID: string, position?: CFrame): Result<ItemComponent, GenericError | ItemMovementError> {
		const register = ItemRegistry[registerUUID];

		// If the item does not exist, reject with 'NOT_FOUND'.
		if (!register) return Result.err(GenericError.NOT_FOUND);

		// If you can't buy this item, reject with 'FORBIDDEN'.
		if (!register.price[PricingExchangeType.BUY]) return Result.err(GenericError.FORBIDDEN);

		// If the user lacks the required amount of curency to purchase this item, reject the request with 'FORBIDDEN'.
		if (getSymmetricEnumMembers(Currency).some((currency) => user.attributes[`Balance_${currency}`] < (register.price[PricingExchangeType.BUY]?.[currency] ?? 0))) return Result.err(GenericError.FORBIDDEN);

		// Subtract the price of the item from the user's balance. If a price isn't specified, assume it is zero.
		getSymmetricEnumMembers(Currency).forEach((currency) => user.attributes[`Balance_${currency}`] -= (register.price[PricingExchangeType.BUY]?.[currency] ?? 0));

		// Create a new item. We don't specify a instance UUID to let it be autogenerated.
		return this.CreateItem(user, registerUUID, undefined, position);
	}

	/**
	 * @param user - The user who owns the item.
	 * @param register - The register uuid of the item.
	 * @param instance - The instance uuid of the item.
	 * @param cframe - The cframe of the item.
	 * @remarks
	 *  - Adds the component to the user's `placed` set.
	 */
	public CreateItem (user: UserComponent, register: string, instance = HttpService.GenerateGUID(false), cframe?: CFrame): Result<ItemComponent, GenericError | ItemMovementError> {
		debug.profilebegin("CreateItem");

		// If there isn't a register for this item, reject.
		if (!ItemRegistry[register]) return Result.err(GenericError.NOT_FOUND);

		// We can be certain a model exists and has a primary part for every register because we asserted it at this service's initialization.
		const model = ItemRegistry[register].model.Clone();

		// If no CFrame was provided, set it so that its at 0x and 0z in the world, with the bottom of the primary part of the item being at 0 y.
		cframe ??= new CFrame(new Vector3(0, (model.PrimaryPart!.Size.Y / 2), 0));

		// Round the provided CFrame.
		const rounded = Dependency<ItemMovementService>().AdjustCFrame(cframe);

		// Start creating the model.
		model.PivotTo(cframe);
		model.SetAttribute("User", user.instance.UserId);
		model.SetAttribute("ItemInstanceUUID", instance);
		model.SetAttribute("ItemRegisterUUID", register);
		model.Name = instance;
		model.Parent = Workspace;

		// Ensure the model is set up as a ItemComponent by tagging it as an item.
		CollectionService.AddTag(model, CollectionTag.ITEM);

		// Return the component after initializing it.
		const component = Dependency<Components>().getComponent<ItemComponent>(model);
		assert(component, "component was not initialized!");

		// Re-adjust the position and parent the item.
		component.instance.PivotTo(rounded);

		// Record the item as placed by the user.
		user.PlacedItems.set(component.attributes.ItemInstanceUUID, component);

		debug.profileend();

		// Return the component.
		return Result.ok(component);
	}

	/**
	 * Returns the item with the specified UUID, if it exists.
	 */
	public GetItem (uuid: string): Option<ItemComponent> {
		const model = game.Workspace.WaitForChild(uuid);
		const item = Dependency<Components>().getComponent<ItemComponent>(model);
		return Option.wrap(item);
	}
}
